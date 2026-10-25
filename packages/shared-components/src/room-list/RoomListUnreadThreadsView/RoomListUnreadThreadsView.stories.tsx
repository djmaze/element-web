/*
 * Copyright 2026 Element Creations Ltd.
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE in the repository root for full details.
 */

import React, { type JSX } from "react";
import { fn } from "storybook/test";

import type { Meta, StoryObj } from "@storybook/react-vite";
import {
    RoomListUnreadThreadsView,
    type RoomListUnreadThreadsViewActions,
    type RoomListUnreadThreadsViewSnapshot,
    type UnreadThreadItem,
} from "./RoomListUnreadThreadsView";
import { useMockedViewModel } from "../../core/viewmodel";
import { withViewDocs } from "../../../.storybook/withViewDocs";

/**
 * The view only hands `room` to `renderAvatar`, so a placeholder object stands in for a real Room.
 */
const FAKE_ROOM = { roomId: "!room:example.org" };

function makeThread(id: string, overrides: Partial<UnreadThreadItem> = {}): UnreadThreadItem {
    return {
        id,
        threadId: `$thread_${id}`,
        room: FAKE_ROOM,
        roomName: "Element Web Contributors",
        threadSenderName: "Alice",
        threadPreview: "Anyone tried the new room list?",
        latestSenderName: "Bob",
        latestPreview: "The new room list looks great",
        notification: {
            hasAnyNotificationOrActivity: true,
            isUnsentMessage: false,
            invited: false,
            isMention: false,
            isActivityNotification: false,
            isNotification: true,
            hasUnreadCount: true,
            count: 3,
            muted: false,
        },
        ...overrides,
    };
}

type RoomListUnreadThreadsProps = RoomListUnreadThreadsViewSnapshot & RoomListUnreadThreadsViewActions;

const RoomListUnreadThreadsViewWrapperImpl = ({
    onToggleExpanded,
    onOpenThread,
    ...rest
}: RoomListUnreadThreadsProps): JSX.Element => {
    const vm = useMockedViewModel(rest, { onToggleExpanded, onOpenThread });
    return <RoomListUnreadThreadsView vm={vm} renderAvatar={() => <div data-testid="avatar" />} />;
};
const RoomListUnreadThreadsViewWrapper = withViewDocs(RoomListUnreadThreadsViewWrapperImpl, RoomListUnreadThreadsView);

const meta = {
    title: "Room List/RoomListUnreadThreadsView",
    component: RoomListUnreadThreadsViewWrapper,
    tags: ["autodocs"],
    args: {
        isExpanded: true,
        threads: [makeThread("1"), makeThread("2"), makeThread("3")],
        hiddenThreadCount: 0,
        onToggleExpanded: fn(),
        onOpenThread: fn(),
    },
} satisfies Meta<typeof RoomListUnreadThreadsViewWrapper>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Collapsed: Story = {
    args: {
        isExpanded: false,
    },
};

export const WithMention: Story = {
    args: {
        threads: [
            makeThread("1", {
                roomName: "Element Web Contributors",
                notification: {
                    hasAnyNotificationOrActivity: true,
                    isUnsentMessage: false,
                    invited: false,
                    isMention: true,
                    isActivityNotification: false,
                    isNotification: false,
                    hasUnreadCount: true,
                    count: 1,
                    muted: false,
                },
            }),
            makeThread("2"),
        ],
    },
};

export const WithHiddenThreads: Story = {
    args: {
        threads: [makeThread("1")],
        hiddenThreadCount: 7,
    },
};

/** A thread whose replies are all read, so only its first message is shown. */
export const RootOnly: Story = {
    args: {
        threads: [makeThread("1", { latestSenderName: "", latestPreview: "" })],
    },
};

/** A thread whose first message is not known: the row falls back to naming the room. */
export const WithoutThreadPreview: Story = {
    args: {
        threads: [makeThread("1", { threadSenderName: "", threadPreview: "" })],
    },
};

export const Empty: Story = {
    args: {
        threads: [],
    },
};
