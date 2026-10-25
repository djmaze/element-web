/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import {
    BaseViewModel,
    type RoomListUnreadThreadsViewActions,
    type RoomListUnreadThreadsViewSnapshot,
    type UnreadThreadItem,
} from "@element-hq/web-shared-components";
import { ClientEvent, type MatrixClient, MatrixEventEvent, RoomEvent } from "matrix-js-sdk/src/matrix";
import throttle from "lodash/throttle";

import type SpaceStore from "../../stores/spaces/SpaceStore";
import { UPDATE_HOME_BEHAVIOUR, UPDATE_SELECTED_SPACE } from "../../stores/spaces";
import { isRoomVisible } from "../../stores/room-list-v3/isRoomVisible";
import { isSectionExpanded, setSectionExpanded } from "../../stores/room-list-v3/section";
import { collectUnreadThreads, type UnreadThread } from "../../utils/threads/unreadThreads";
import { threadDecorationProps } from "../../utils/threads/threadDecoration";
import { MessagePreviewStore } from "../../stores/message-preview/MessagePreviewStore";
import { getSenderName } from "../../stores/message-preview/previews/utils";
import RightPanelStore from "../../stores/right-panel/RightPanelStore";
import { RightPanelPhases } from "../../stores/right-panel/RightPanelStorePhases";
import { Action } from "../../dispatcher/actions";
import dispatcher from "../../dispatcher/dispatcher";
import { type ViewRoomPayload } from "../../dispatcher/payloads/ViewRoomPayload";
import SettingsStore from "../../settings/SettingsStore";

/**
 * The section holds at most this many threads. The rest are reported in the caption below the rows,
 * so the section cannot push the room sections far down the sidebar. Each row runs taller than a
 * room list item, which is why the cap is lower than the room sections' worth of rows.
 */
const MAX_VISIBLE_THREADS = 6;

/**
 * Threads are recomputed on sync, decryption and receipts, which can arrive in bursts. Recompute at
 * most this often, matching the Threads Activity Centre.
 */
const MIN_UPDATE_INTERVAL_MS = 500;

/**
 * Key under which the section's expanded state is persisted, in the same per-space record the room
 * list sections use. The section is not a room tag, so this key is never applied to a room.
 */
export const UNREAD_THREADS_SECTION_TAG = "unread_threads";

interface RoomListUnreadThreadsViewModelProps {
    client: MatrixClient;
    spaceStore: SpaceStore;
}

/**
 * Backs the "Unread threads" section at the top of the room list: the unread threads of the rooms in
 * the active space, threads the user took part in first.
 */
export class RoomListUnreadThreadsViewModel
    extends BaseViewModel<RoomListUnreadThreadsViewSnapshot, RoomListUnreadThreadsViewModelProps>
    implements RoomListUnreadThreadsViewActions
{
    /**
     * Every unread thread in the active space, most relevant first. The snapshot only carries the
     * first {@link MAX_VISIBLE_THREADS} of them, but a row click has to work for the rest too.
     */
    private threads: UnreadThread[] = [];

    /** Recompute at most once per {@link MIN_UPDATE_INTERVAL_MS}. */
    private readonly scheduleUpdate = throttle(() => this.update(), MIN_UPDATE_INTERVAL_MS, {
        leading: false,
        trailing: true,
    });

    public constructor(props: RoomListUnreadThreadsViewModelProps) {
        super(props, {
            isExpanded: isSectionExpanded(props.spaceStore.activeSpace, UNREAD_THREADS_SECTION_TAG),
            threads: [],
            hiddenThreadCount: 0,
        });

        // The same signals the Threads Activity Centre uses: a sync brings new notification counts,
        // decryption makes events previewable, and a receipt from this device marks a thread read
        // long before the server's counts catch up.
        this.disposables.trackListener(props.client, ClientEvent.Sync, this.scheduleUpdate);
        this.disposables.trackListener(props.client, MatrixEventEvent.Decrypted, this.scheduleUpdate);
        this.disposables.trackListener(props.client, RoomEvent.Receipt, this.scheduleUpdate);
        this.disposables.trackListener(props.client, RoomEvent.UnreadNotifications, this.scheduleUpdate);

        // The threads on show depend on the active space, and so does the persisted expanded state.
        const onSpaceChange = (): void => {
            const isExpanded = isSectionExpanded(this.props.spaceStore.activeSpace, UNREAD_THREADS_SECTION_TAG);
            this.snapshot.merge({ isExpanded });
            this.scheduleUpdate();
        };
        this.props.spaceStore.on(UPDATE_SELECTED_SPACE, onSpaceChange);
        this.props.spaceStore.on(UPDATE_HOME_BEHAVIOUR, onSpaceChange);
        this.disposables.track(() => {
            this.props.spaceStore.off(UPDATE_SELECTED_SPACE, onSpaceChange);
            this.props.spaceStore.off(UPDATE_HOME_BEHAVIOUR, onSpaceChange);
            this.scheduleUpdate.cancel();
        });

        this.update();
    }

    public onToggleExpanded = (): void => {
        const isExpanded = !this.snapshot.current.isExpanded;
        // Not critical, so don't hold the UI back waiting for storage, as with the room list sections.
        void setSectionExpanded(this.props.spaceStore.activeSpace, UNREAD_THREADS_SECTION_TAG, isExpanded);
        this.snapshot.merge({ isExpanded });
    };

    public onOpenThread = (threadId: string): void => {
        const found = this.threads.find((unreadThread) => unreadThread.thread.id === threadId);
        if (!found) return;

        // Open the thread over the thread list, as the Threads Activity Centre does, so the thread
        // view gets a working way back.
        if (found.thread.rootEvent) {
            RightPanelStore.instance.setCards(
                [
                    { phase: RightPanelPhases.ThreadPanel },
                    { phase: RightPanelPhases.ThreadView, state: { threadHeadEvent: found.thread.rootEvent } },
                ],
                true,
                found.room.roomId,
            );
        }

        dispatcher.dispatch<ViewRoomPayload>({
            action: Action.ViewRoom,
            show_room_tile: true,
            room_id: found.room.roomId,
            metricsTrigger: "RoomList",
            focusNext: "threadsPanel",
        });
    };

    /** Recompute the unread threads of the active space and publish them to the view. */
    private update(): void {
        if (this.isDisposed) return;

        const { client, spaceStore } = this.props;
        const spaceId = spaceStore.activeSpace;
        const msc3946ProcessDynamicPredecessor = SettingsStore.getValue("feature_dynamic_room_predecessors");

        // The section sits inside the space's room list, so it lists the threads of that space's
        // rooms only, and only of rooms the room list itself would show.
        const rooms = client
            .getVisibleRooms(msc3946ProcessDynamicPredecessor)
            .filter((room) => isRoomVisible(room) && spaceStore.isRoomInSpace(spaceId, room.roomId));

        const { participatingThreads, otherThreads } = collectUnreadThreads(client, rooms);
        const threads = [...participatingThreads, ...otherThreads];
        this.threads = threads;

        const visible = threads.slice(0, MAX_VISIBLE_THREADS);
        this.snapshot.merge({
            threads: visible.map((unreadThread) => this.toItem(unreadThread)),
            hiddenThreadCount: threads.length - visible.length,
        });
    }

    /**
     * Turn an unread thread into the row data the view renders. Only called for the threads on show,
     * since building a preview costs more than the rest of the row.
     */
    private toItem(unreadThread: UnreadThread): UnreadThreadItem {
        // Two lines of preview: the first message is what names the thread, the newest one is what
        // the user has not read yet. A thread with no replies needs only the first line.
        const rootEvent = unreadThread.thread.rootEvent;
        const latestEvent = unreadThread.thread.events.at(-1);
        const hasReply = !!latestEvent && latestEvent.getId() !== rootEvent?.getId();

        return {
            id: `${unreadThread.room.roomId}:${unreadThread.thread.id}`,
            threadId: unreadThread.thread.id,
            room: unreadThread.room,
            roomName: unreadThread.room.name,
            threadSenderName: rootEvent ? getSenderName(rootEvent) : "",
            threadPreview: rootEvent ? MessagePreviewStore.instance.generatePreviewForEvent(rootEvent) : "",
            latestSenderName: hasReply ? getSenderName(latestEvent) : "",
            latestPreview: hasReply ? MessagePreviewStore.instance.generatePreviewForEvent(latestEvent) : "",
            notification: threadDecorationProps(
                unreadThread.notificationLevel,
                unreadThread.notificationCount,
                unreadThread.muted,
            ),
        };
    }
}
