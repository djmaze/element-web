/*
 * Copyright 2026 Element Creations Ltd.
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE in the repository root for full details.
 */

// @vitest-environment happy-dom

import { beforeEach, afterEach, describe, expect, it, vi, type Mock } from "vitest";
import {
    MatrixEventEvent,
    NotificationCountType,
    PendingEventOrdering,
    Room,
    RoomEvent,
    type MatrixClient,
} from "matrix-js-sdk/src/matrix";
import { stubClient, TestSDKContext } from "test-utils";
import { populateThread } from "test-utils/threads";

import { RoomListUnreadThreadsViewModel, UNREAD_THREADS_SECTION_TAG } from "./RoomListUnreadThreadsViewModel";
import type SpaceStore from "../../stores/spaces/SpaceStore";
import { UPDATE_SELECTED_SPACE, type SpaceKey } from "../../stores/spaces";
import { SDKContextClass } from "../../contexts/SDKContextClass";
import { MessagePreviewStore } from "../../stores/message-preview/MessagePreviewStore";
import RightPanelStore from "../../stores/right-panel/RightPanelStore";
import { RightPanelPhases } from "../../stores/right-panel/RightPanelStorePhases";
import { Action } from "../../dispatcher/actions";
import dispatcher from "../../dispatcher/dispatcher";
import SettingsStore from "../../settings/SettingsStore";
import { SettingLevel } from "../../settings/SettingLevel";
import { type SectionExpansionState } from "../../stores/room-list-v3/section";

const SPACE_ID = "!space:example.org";
const MY_USER_ID = "@fee:bar";
/**
 * The threads in these tests are replied to by this user. Replying marks a thread as read for its
 * author, so the user whose unread threads we list must not be the one replying.
 */
const OTHER_USER_ID = "@foo:bar";
/** A thread's first message is sent by this user, distinct from whoever replies. */
const ROOT_AUTHOR_ID = "@root:bar";

describe("RoomListUnreadThreadsViewModel", () => {
    let client: MatrixClient;
    let room: Room;
    let sectionExpansionState: SectionExpansionState;
    let setValue: Mock;
    let dispatch: Mock;
    let setCards: Mock;
    let viewModels: RoomListUnreadThreadsViewModel[];

    /**
     * Point the real space store at a space that holds exactly the given rooms. The view model only
     * reads the active space, asks whether a room is in it, and listens for the space changing.
     */
    function makeSpaceStore(roomIds: string[] = []): SpaceStore {
        const spaceStore = SDKContextClass.instance.spaceStore;
        vi.spyOn(spaceStore, "activeSpace", "get").mockReturnValue(SPACE_ID);
        vi.spyOn(spaceStore, "isRoomInSpace").mockImplementation((_spaceId: SpaceKey, roomId: string) =>
            roomIds.includes(roomId),
        );
        return spaceStore;
    }

    function makeViewModel(spaceStore: SpaceStore = makeSpaceStore()): RoomListUnreadThreadsViewModel {
        const vm = new RoomListUnreadThreadsViewModel({ client, spaceStore });
        viewModels.push(vm);
        return vm;
    }

    /** Give a thread the notification counts a homeserver would have pushed for it. */
    function notify(threadId: string, type: NotificationCountType, count: number): void {
        room.setThreadUnreadNotificationCount(threadId, type, count);
    }

    beforeEach(() => {
        // The view model throttles its recomputation, so control the clock to see it fire.
        vi.useFakeTimers();
        client = stubClient();
        client.supportsThreads = () => true;
        client.getSafeUserId = vi.fn().mockReturnValue(MY_USER_ID);

        room = new Room("!room1:example.org", client, MY_USER_ID, {
            pendingEventOrdering: PendingEventOrdering.Detached,
        });
        client.getVisibleRooms = vi.fn().mockImplementation(() => [room]);

        const sdkContext = new TestSDKContext();
        sdkContext._client = client;
        viewModels = [];

        sectionExpansionState = {};
        setValue = vi.spyOn(SettingsStore, "setValue").mockImplementation(async (setting, _roomId, _level, value) => {
            if (setting === "RoomList.SectionExpansionState") sectionExpansionState = value as SectionExpansionState;
        });
        vi.spyOn(SettingsStore, "getValue").mockImplementation((setting) => {
            if (setting === "RoomList.SectionExpansionState") return sectionExpansionState;
            return false;
        });

        dispatch = vi.spyOn(dispatcher, "dispatch").mockImplementation(() => true);
        setCards = vi.spyOn(RightPanelStore.instance, "setCards").mockResolvedValue(undefined);
        // Preview text straight from the event body, so a row's two lines can be told apart.
        vi.spyOn(MessagePreviewStore.instance, "generatePreviewForEvent").mockImplementation((event) =>
            String(event.getContent().body),
        );
    });

    afterEach(() => {
        viewModels.forEach((vm) => vm.dispose());
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    it("lists an unread thread with its room, its first message and its newest one", async () => {
        const { thread } = await populateThread({
            room,
            client,
            authorId: ROOT_AUTHOR_ID,
            participantUserIds: [OTHER_USER_ID],
        });
        notify(thread.id, NotificationCountType.Total, 3);

        const { threads, hiddenThreadCount } = makeViewModel(makeSpaceStore([room.roomId])).getSnapshot();

        expect(threads).toHaveLength(1);
        expect(threads[0]).toEqual({
            id: `${room.roomId}:${thread.id}`,
            threadId: thread.id,
            room,
            roomName: room.name,
            threadSenderName: ROOT_AUTHOR_ID,
            threadPreview: expect.stringMatching(/^root event message/),
            latestSenderName: OTHER_USER_ID,
            latestPreview: `reply 1 by ${OTHER_USER_ID}`,
            notification: expect.objectContaining({
                isNotification: true,
                isMention: false,
                hasUnreadCount: true,
                count: 3,
                muted: false,
            }),
        });
        expect(hiddenThreadCount).toBe(0);
    });

    it("leaves the newest message out when the thread has no replies", async () => {
        const { thread } = await populateThread({
            room,
            client,
            authorId: ROOT_AUTHOR_ID,
            participantUserIds: [OTHER_USER_ID],
            length: 1,
        });
        notify(thread.id, NotificationCountType.Total, 1);

        const { threads } = makeViewModel(makeSpaceStore([room.roomId])).getSnapshot();

        expect(threads[0].threadSenderName).toBe(ROOT_AUTHOR_ID);
        expect(threads[0].threadPreview).toMatch(/^root event message/);
        expect(threads[0].latestSenderName).toBe("");
        expect(threads[0].latestPreview).toBe("");
    });

    it("reports a mention as a mention", async () => {
        const { thread } = await populateThread({
            room,
            client,
            authorId: "@foo:bar",
            participantUserIds: [OTHER_USER_ID],
        });
        notify(thread.id, NotificationCountType.Total, 2);
        notify(thread.id, NotificationCountType.Highlight, 1);

        const { threads } = makeViewModel(makeSpaceStore([room.roomId])).getSnapshot();

        expect(threads[0].notification).toEqual(
            expect.objectContaining({ isMention: true, isNotification: false, count: 2 }),
        );
    });

    it("lists nothing when the thread has been read", async () => {
        const { thread } = await populateThread({
            room,
            client,
            authorId: "@foo:bar",
            participantUserIds: [OTHER_USER_ID],
        });
        // Read through the thread's latest event: the thread is no longer something to catch up on.
        expect(thread.events).not.toHaveLength(0);
        vi.spyOn(room, "hasUserReadEvent").mockReturnValue(true);

        const { threads } = makeViewModel(makeSpaceStore([room.roomId])).getSnapshot();

        expect(threads).toHaveLength(0);
    });

    it("lists nothing for rooms outside the active space", async () => {
        await populateThread({ room, client, authorId: "@foo:bar", participantUserIds: [OTHER_USER_ID] });

        const { threads } = makeViewModel(makeSpaceStore([])).getSnapshot();

        expect(threads).toHaveLength(0);
    });

    it("lists nothing for rooms the room list would not show", async () => {
        await populateThread({ room, client, authorId: "@foo:bar", participantUserIds: [OTHER_USER_ID] });
        const spaceRoom = new Room("!space2:example.org", client, MY_USER_ID);
        spaceRoom.isSpaceRoom = vi.fn().mockReturnValue(true);
        client.getVisibleRooms = vi.fn().mockReturnValue([spaceRoom]);

        const { threads } = makeViewModel(makeSpaceStore([spaceRoom.roomId])).getSnapshot();

        expect(threads).toHaveLength(0);
    });

    it("puts threads the user took part in before the rest", async () => {
        const other = await populateThread({
            room,
            client,
            authorId: "@alice:bar",
            participantUserIds: [OTHER_USER_ID],
            ts: 10,
        });
        const mine = await populateThread({
            room,
            client,
            authorId: "@bob:bar",
            participantUserIds: [OTHER_USER_ID],
            ts: 1,
        });
        vi.spyOn(mine.thread, "hasCurrentUserParticipated", "get").mockReturnValue(true);
        notify(other.thread.id, NotificationCountType.Total, 2);
        notify(mine.thread.id, NotificationCountType.Total, 1);

        const { threads } = makeViewModel(makeSpaceStore([room.roomId])).getSnapshot();

        expect(threads.map((t) => t.threadId)).toEqual([mine.thread.id, other.thread.id]);
    });

    it("caps the rows it shows and reports the rest", async () => {
        const ids: string[] = [];
        for (let i = 0; i < 10; i++) {
            const { thread } = await populateThread({
                room,
                client,
                authorId: `@user${i}:bar`,
                participantUserIds: [OTHER_USER_ID],
                length: 1,
                ts: i + 1,
            });
            notify(thread.id, NotificationCountType.Total, 1);
            ids.push(thread.id);
        }

        const { threads, hiddenThreadCount } = makeViewModel(makeSpaceStore([room.roomId])).getSnapshot();

        // Six of the ten threads are shown, the rest counted in the caption.
        expect(threads).toHaveLength(6);
        expect(hiddenThreadCount).toBe(4);
        // Equal notification levels, so the newest reply leads.
        expect(threads[0].threadId).toBe(ids[9]);
        expect(threads[5].threadId).toBe(ids[4]);
    });

    it("persists the expanded state when the section is toggled", async () => {
        await populateThread({ room, client, authorId: "@foo:bar", participantUserIds: [OTHER_USER_ID] });
        const vm = makeViewModel(makeSpaceStore([room.roomId]));
        expect(vm.getSnapshot().isExpanded).toBe(true);

        vm.onToggleExpanded();

        expect(vm.getSnapshot().isExpanded).toBe(false);
        expect(setValue).toHaveBeenCalledWith(
            "RoomList.SectionExpansionState",
            null,
            SettingLevel.DEVICE,
            expect.objectContaining({ [SPACE_ID]: { [UNREAD_THREADS_SECTION_TAG]: false } }),
        );
    });

    it("starts collapsed when the persisted state says so", async () => {
        await populateThread({ room, client, authorId: "@foo:bar", participantUserIds: [OTHER_USER_ID] });
        sectionExpansionState = { [SPACE_ID]: { [UNREAD_THREADS_SECTION_TAG]: false } };

        const { isExpanded } = makeViewModel(makeSpaceStore([room.roomId])).getSnapshot();

        expect(isExpanded).toBe(false);
    });

    it("opens the thread in its room when a row is clicked", async () => {
        const { thread, rootEvent } = await populateThread({
            room,
            client,
            authorId: "@foo:bar",
            participantUserIds: [OTHER_USER_ID],
        });
        notify(thread.id, NotificationCountType.Total, 1);
        const vm = makeViewModel(makeSpaceStore([room.roomId]));
        expect(vm.getSnapshot().threads).toHaveLength(1);

        vm.onOpenThread(thread.id);

        expect(setCards).toHaveBeenCalledWith(
            [
                { phase: RightPanelPhases.ThreadPanel },
                { phase: RightPanelPhases.ThreadView, state: { threadHeadEvent: rootEvent } },
            ],
            true,
            room.roomId,
        );
        expect(dispatch).toHaveBeenCalledWith(
            expect.objectContaining({ action: Action.ViewRoom, room_id: room.roomId, show_room_tile: true }),
        );
    });

    it("ignores a click for a thread it no longer has", async () => {
        const vm = makeViewModel(makeSpaceStore([room.roomId]));

        vm.onOpenThread("$unknown:example.org");

        expect(setCards).not.toHaveBeenCalled();
        expect(dispatch).not.toHaveBeenCalled();
    });

    it("refreshes when a space change arrives", async () => {
        await populateThread({ room, client, authorId: "@foo:bar", participantUserIds: [OTHER_USER_ID] });
        const spaceStore = makeSpaceStore([]);
        const vm = makeViewModel(spaceStore);
        expect(vm.getSnapshot().threads).toHaveLength(0);

        // Move the room into the active space and announce the switch. The recomputation is
        // throttled, so the timer that carries it has to run for the snapshot to change.
        vi.mocked(spaceStore.isRoomInSpace).mockImplementation(() => true);
        spaceStore.emit(UPDATE_SELECTED_SPACE);
        await vi.advanceTimersByTimeAsync(1000);

        expect(vm.getSnapshot().threads).toHaveLength(1);
    });

    it("removes its listeners once disposed", async () => {
        await populateThread({ room, client, authorId: "@foo:bar", participantUserIds: [OTHER_USER_ID] });
        const spaceStore = makeSpaceStore([room.roomId]);
        const vm = makeViewModel(spaceStore);
        const off = vi.spyOn(client, "off");

        vm.dispose();

        expect(off).toHaveBeenCalledWith(MatrixEventEvent.Decrypted, expect.any(Function));
        expect(off).toHaveBeenCalledWith(RoomEvent.Receipt, expect.any(Function));
        expect(spaceStore.listenerCount(UPDATE_SELECTED_SPACE)).toBe(0);
    });
});
