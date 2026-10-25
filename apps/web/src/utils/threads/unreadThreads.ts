/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { type MatrixClient, NotificationCountType, type Room, type Thread } from "matrix-js-sdk/src/matrix";

import { doesTimelineHaveUnreadMessages } from "../../Unread";
import { NotificationLevel } from "../../stores/notifications/NotificationLevel";
import { getRoomNotifsState, RoomNotifState } from "../../RoomNotifs";

/**
 * An unread thread, together with the room it belongs to and how loudly it should be reported.
 */
export type UnreadThread = {
    /** The unread thread. */
    thread: Thread;
    /** The room the thread belongs to. */
    room: Room;
    /** The notification level of the thread. */
    notificationLevel: NotificationLevel;
    /** The server-reported total notification count, or 0 for locally-detected unreads. */
    notificationCount: number;
    /** Whether the thread's room is muted. */
    muted: boolean;
    /** Whether the user took part in the thread or was mentioned in it. */
    isRelevantToMe: boolean;
};

/**
 * The unread state of a single thread, or `null` when the thread has nothing unread to surface.
 */
export type ThreadUnread = {
    /** The notification level derived from the server counts, or {@link NotificationLevel.Activity} for local-only unreads. */
    notificationLevel: NotificationLevel;
    /** The homeserver's total notification count for the thread; 0 for a local-only unread. */
    notificationCount: number;
    /** Whether the homeserver reported a notification count for the thread, as opposed to a local-only unread. */
    hasServerNotifs: boolean;
    /** Whether the user participated in the thread, or was mentioned or keyword-matched in it. */
    isRelevantToMe: boolean;
};

/**
 * Options for {@link collectUnreadThreads}.
 */
export type CollectUnreadThreadsOptions = {
    /**
     * Drop threads whose unread state was detected locally rather than reported by the homeserver.
     * Used by the Threads Activity Centre to keep its "Other threads" tab to real notifications.
     */
    onlyWithServerNotifications?: boolean;
};

/**
 * The unread threads of a set of rooms, split by how much they concern the user.
 */
export type UnreadThreadGroups = {
    /** Threads the user took part in or was mentioned in. */
    participatingThreads: UnreadThread[];
    /** Everything else. */
    otherThreads: UnreadThread[];
};

/**
 * Evaluate a single thread's unread state, preferring the homeserver's notification counts and
 * falling back to local timeline inspection for threads the server has not pushed counts for.
 *
 * @param client - The matrix client
 * @param room - The room the thread belongs to
 * @param thread - The thread to evaluate
 * @returns the thread's unread state, or `null` when there is nothing unread to surface
 */
export function evaluateThreadUnread(client: MatrixClient, room: Room, thread: Thread): ThreadUnread | null {
    // Reading writes a local echo receipt straight away, but the server's `total` count only clears
    // when the homeserver pushes fresh counts in a sync (the js-sdk deliberately doesn't recompute
    // totals locally). Without this, a thread you just read stays listed, with its count, until the
    // server catches up. An explicit receipt covering the thread's latest event beats a stale count.
    if (hasReadThroughLatestEvent(client, room, thread)) return null;

    // Primary signal: server-reported notification counts (authoritative).
    const highlight = room.getThreadUnreadNotificationCount(thread.id, NotificationCountType.Highlight);
    const total = room.getThreadUnreadNotificationCount(thread.id, NotificationCountType.Total);
    const hasServerNotifs = highlight > 0 || total > 0;

    // Fallback: local timeline inspection, computed lazily (skip when the server already gave us a signal).
    const hasUnread = hasServerNotifs || doesTimelineHaveUnreadMessages(room, thread.events);
    if (!hasUnread) return null;

    let notificationLevel = NotificationLevel.Activity;
    if (highlight > 0) notificationLevel = NotificationLevel.Highlight;
    else if (total > 0) notificationLevel = NotificationLevel.Notification;

    return {
        notificationLevel,
        notificationCount: total,
        hasServerNotifs,
        isRelevantToMe: thread.hasCurrentUserParticipated || highlight > 0,
    };
}

/**
 * Collect the unread threads of the given rooms, split into the ones the user took part in and the
 * rest.
 *
 * A thread counts as "participating" when the user posted in it or was mentioned in it. Those are
 * always returned. The others skip muted rooms, and are skipped entirely when
 * `onlyWithServerNotifications` is set and the homeserver reported nothing for them.
 *
 * @param client - The matrix client
 * @param rooms - The rooms to look at. The caller decides which rooms are in scope.
 * @param options - See {@link CollectUnreadThreadsOptions}
 */
export function collectUnreadThreads(
    client: MatrixClient,
    rooms: Room[],
    options: CollectUnreadThreadsOptions = {},
): UnreadThreadGroups {
    const participatingThreads: UnreadThread[] = [];
    const otherThreads: UnreadThread[] = [];

    for (const room of rooms) {
        const isRoomMuted = getRoomNotifsState(client, room.roomId) === RoomNotifState.Mute;

        for (const thread of room.getThreads()) {
            const unread = evaluateThreadUnread(client, room, thread);
            if (!unread) continue;

            const threadData: UnreadThread = {
                thread,
                room,
                notificationLevel: unread.notificationLevel,
                notificationCount: unread.notificationCount,
                muted: isRoomMuted,
                isRelevantToMe: unread.isRelevantToMe,
            };

            if (unread.isRelevantToMe) {
                // Participating threads are always shown, even in a muted room or when the caller
                // only wants server notifications.
                participatingThreads.push(threadData);
            } else if (!isRoomMuted && (!options.onlyWithServerNotifications || unread.hasServerNotifs)) {
                otherThreads.push(threadData);
            }
        }
    }

    participatingThreads.sort(sortUnreadThreads);
    otherThreads.sort(sortUnreadThreads);

    return { participatingThreads, otherThreads };
}

/**
 * Sort unread threads by notification level, most important first, then by the time of their latest
 * event, most recent first.
 *
 * @param a - First thread to compare
 * @param b - Second thread to compare
 * @returns A comparator result
 */
export function sortUnreadThreads(a: UnreadThread, b: UnreadThread): number {
    if (a.notificationLevel !== b.notificationLevel) return b.notificationLevel - a.notificationLevel;
    const tsA = a.thread.events.at(-1)?.getTs() ?? 0;
    const tsB = b.thread.events.at(-1)?.getTs() ?? 0;
    return tsB - tsA;
}

/**
 * Whether we have read the most recent event we know of in the thread.
 *
 * Uses {@link Room.hasUserReadEvent}, the same receipt lookup {@link doesTimelineHaveUnreadMessages}
 * relies on, rather than {@link Thread.hasUserReadEvent}: the latter treats a thread as read whenever
 * the room holds no threaded receipt at all (it compares against `getOldestThreadedReceiptTs()`,
 * which is `Infinity` until one arrives), which would hide every thread on a fresh session.
 *
 * @returns true if the thread has been read up to its latest known event
 */
function hasReadThroughLatestEvent(client: MatrixClient, room: Room, thread: Thread): boolean {
    const latestEventId = thread.events.at(-1)?.getId();
    return !!latestEventId && room.hasUserReadEvent(client.getSafeUserId(), latestEventId);
}
