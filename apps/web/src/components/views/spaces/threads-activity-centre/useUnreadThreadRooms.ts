/*
 * Copyright 2024 New Vector Ltd.
 * Copyright 2024 The Matrix.org Foundation C.I.C.
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { ClientEvent, type MatrixClient, MatrixEventEvent, type Room, RoomEvent } from "matrix-js-sdk/src/matrix";
import { throttle } from "lodash";

import { NotificationLevel } from "../../../../stores/notifications/NotificationLevel";
import { getThreadNotificationLevel } from "../../../../utils/notifications";
import { collectUnreadThreads, type UnreadThread } from "../../../../utils/threads/unreadThreads";
import { useSettingValue } from "../../../../hooks/useSettings";
import { useMatrixClientContext } from "../../../../contexts/MatrixClientContext";
import { useEventEmitter } from "../../../../hooks/useEventEmitter";
import { isRoomVisible } from "../../../../stores/room-list-v3/isRoomVisible";

const MIN_UPDATE_INTERVAL_MS = 500;

/**
 * An unread thread displayed in the Threads Activity Centre.
 */
export type ThreadData = UnreadThread;

/**
 * The unread threads to display in the Threads Activity Centre.
 */
export type UnreadThreadRooms = {
    /** The highest notification level across all the displayed threads. */
    greatestNotificationLevel: NotificationLevel;
    /** The rooms contributing at least one displayed thread, and their notification level. */
    rooms: Array<{ room: Room; notificationLevel: NotificationLevel }>;
    /** The unread threads relevant to the user, shown in the "My threads" tab. */
    participatingThreads: ThreadData[];
    /** The other unread threads, shown in the "Other threads" tab. */
    otherThreads: ThreadData[];
};

/**
 * Return the unread threads split into "my threads" and "other threads", the rooms that
 * contribute at least one displayed thread, and the greatest notification level across them.
 * See {@link computeUnreadThreadRooms} for how threads are categorised.
 * The result is computed when the client syncs, or when forceComputation is true.
 * @param forceComputation
 * @returns {UnreadThreadRooms}
 */
export function useUnreadThreadRooms(forceComputation: boolean): UnreadThreadRooms {
    const msc3946ProcessDynamicPredecessor = useSettingValue("feature_dynamic_room_predecessors");
    const settingTACOnlyNotifs = useSettingValue("Notifications.tac_only_notifications");
    const mxClient = useMatrixClientContext();

    const [result, setResult] = useState<UnreadThreadRooms>({
        greatestNotificationLevel: NotificationLevel.None,
        rooms: [],
        participatingThreads: [],
        otherThreads: [],
    });

    const doUpdate = useCallback(() => {
        setResult(computeUnreadThreadRooms(mxClient, msc3946ProcessDynamicPredecessor, settingTACOnlyNotifs));
    }, [mxClient, msc3946ProcessDynamicPredecessor, settingTACOnlyNotifs]);

    const scheduleUpdate = useMemo(
        () =>
            throttle(doUpdate, MIN_UPDATE_INTERVAL_MS, {
                leading: false,
                trailing: true,
            }),
        [doUpdate],
    );
    useEffect(() => () => scheduleUpdate.cancel(), [scheduleUpdate]);

    // Listen to sync events to update the result
    useEventEmitter(mxClient, ClientEvent.Sync, scheduleUpdate);
    // and also when events get decrypted, since this will often happen after the sync
    // event and may change notifications.
    useEventEmitter(mxClient, MatrixEventEvent.Decrypted, scheduleUpdate);
    // Reading a thread echoes a receipt locally, well before the server sends fresh notification
    // counts. Recompute on that instead of waiting for the next sync, so a thread the user just
    // read leaves the list at once, as it does in the room list.
    useEventEmitter(mxClient, RoomEvent.Receipt, scheduleUpdate);

    // Force the list computation
    useEffect(() => {
        if (forceComputation) {
            doUpdate();
        }
    }, [doUpdate, forceComputation]);

    return result;
}

/**
 * Compute the list of unread threads, split into "my threads" (relevant to the user)
 * and "other threads" (everything else), along with notification levels.
 *
 * The thread categorisation itself lives in {@link collectUnreadThreads}: a thread goes to
 * "My threads" when the user participated in it or was mentioned in it, and to "Other threads"
 * otherwise. "My threads" is always shown in full; "Other threads" skips muted rooms, and, when
 * `settingTACOnlyNotifs` is on, threads without a server-reported notification count.
 *
 * `rooms` and `greatestNotificationLevel` only cover rooms contributing a displayed thread,
 * so the indicator badge matches the popup content.
 *
 * @param mxClient - MatrixClient
 * @param msc3946ProcessDynamicPredecessor
 * @param settingTACOnlyNotifs
 */
function computeUnreadThreadRooms(
    mxClient: MatrixClient,
    msc3946ProcessDynamicPredecessor: boolean,
    settingTACOnlyNotifs: boolean,
): UnreadThreadRooms {
    // Only count visible rooms to not torment the user with notification counts in rooms they can't see.
    // This will include highlights from the previous version of the room internally
    const visibleRooms = mxClient
        .getVisibleRooms(msc3946ProcessDynamicPredecessor)
        .filter((room: Room) => isRoomVisible(room));

    const { participatingThreads, otherThreads } = collectUnreadThreads(mxClient, visibleRooms, {
        onlyWithServerNotifications: settingTACOnlyNotifs,
    });

    // Only surface a room in the indicator when at least one of its threads is shown.
    const roomsContributing = new Map<string, Room>();
    for (const { room } of [...participatingThreads, ...otherThreads]) {
        roomsContributing.set(room.roomId, room);
    }

    const rooms: UnreadThreadRooms["rooms"] = [];
    let greatestNotificationLevel = NotificationLevel.None;
    for (const room of roomsContributing.values()) {
        const notificationLevel = getThreadNotificationLevel(room);
        if (notificationLevel > greatestNotificationLevel) {
            greatestNotificationLevel = notificationLevel;
        }
        rooms.push({ room, notificationLevel });
    }

    rooms.sort(sortRoom);

    return { greatestNotificationLevel, rooms, participatingThreads, otherThreads };
}

/**
 * Store the room and its thread notification level
 */
type RoomData = UnreadThreadRooms["rooms"][0];

/**
 * Sort notification level by the most important notification level to the least important
 * Highlight > Notification > Activity
 * If the notification level is the same, we sort by the most recent thread
 * @param roomDataA - room and notification level of room A
 * @param roomDataB - room and notification level of room B
 * @returns {number}
 */
function sortRoom(roomDataA: RoomData, roomDataB: RoomData): number {
    const { notificationLevel: notificationLevelA, room: roomA } = roomDataA;
    const { notificationLevel: notificationLevelB, room: roomB } = roomDataB;

    const timestampA = roomA.getLastThread()?.events.at(-1)?.getTs();
    const timestampB = roomB.getLastThread()?.events.at(-1)?.getTs();

    // NotificationLevel is a numeric enum, so we can compare them directly
    if (notificationLevelA > notificationLevelB) return -1;
    else if (notificationLevelB > notificationLevelA) return 1;
    // Display most recent first
    else if (!timestampA) return 1;
    else if (!timestampB) return -1;
    else return timestampB - timestampA;
}
