/*
 * Copyright 2026 Element Creations Ltd.
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE in the repository root for full details.
 */

import React, { type JSX, type ReactNode, memo } from "react";
import ChevronRightIcon from "@vector-im/compound-design-tokens/assets/web/icons/chevron-right";
import { Text } from "@vector-im/compound-web";

import { useViewModel, type ViewModel } from "../../core/viewmodel";
import { _t } from "../../core/i18n/i18n";
import { Flex } from "../../core/utils/Flex";
import {
    NotificationDecoration,
    type NotificationDecorationData,
    type Room,
} from "../VirtualizedRoomListView/RoomListItemWrapper/RoomListItemView";
import styles from "./RoomListUnreadThreadsView.module.css";

/**
 * One unread thread, as needed to render its row.
 */
export interface UnreadThreadItem {
    /** Unique identifier for the row, used as its React key. */
    id: string;
    /** The thread this row opens. */
    threadId: string;
    /** The room the thread belongs to, passed to `renderAvatar`. */
    room: Room;
    /** Name of that room. */
    roomName: string;
    /** Display name of the sender of the thread's first message, empty when unknown. */
    threadSenderName: string;
    /** Preview of the thread's first message, which is what names the thread. */
    threadPreview: string;
    /** Display name of the sender of the newest message, empty when unknown or when the newest
     * message is the thread's first one. */
    latestSenderName: string;
    /** Preview of the newest message, empty when unknown or when it is the thread's first message. */
    latestPreview: string;
    /** The notification decoration data for the thread. */
    notification: NotificationDecorationData;
}

/**
 * Snapshot for the unread threads section of the room list.
 */
export interface RoomListUnreadThreadsViewSnapshot {
    /** Whether the section is currently expanded. */
    isExpanded: boolean;
    /** The threads to display, most relevant first. */
    threads: UnreadThreadItem[];
    /** How many unread threads are not displayed because the section caps its rows. */
    hiddenThreadCount: number;
}

/**
 * Actions of the unread threads section.
 */
export interface RoomListUnreadThreadsViewActions {
    /** Toggle the section open or closed. */
    onToggleExpanded: () => void;
    /** Open the given thread in its room. */
    onOpenThread: (threadId: string) => void;
}

/**
 * The view model type for the unread threads section.
 */
export type RoomListUnreadThreadsViewModel = ViewModel<
    RoomListUnreadThreadsViewSnapshot,
    RoomListUnreadThreadsViewActions
>;

/**
 * Props for {@link RoomListUnreadThreadsView}.
 */
export interface RoomListUnreadThreadsViewProps {
    /** The view model containing the threads and the section actions. */
    vm: RoomListUnreadThreadsViewModel;
    /** Render function for the avatar of the room a thread belongs to. */
    renderAvatar: (room: Room) => ReactNode;
}

/**
 * Build a row's accessible name. The row sets its own `aria-label`, which replaces its content, so
 * the notification counter would otherwise go unannounced. Each state is a whole translated
 * sentence, since word order depends on the language.
 *
 * The name describes the thread by its first message, the same line that names it visually, and not
 * by the newest reply: the reply says what happened, the first message says which thread it happened in.
 *
 * @param thread - The thread to describe
 * @returns The accessible name of the row
 */
function getA11yLabel(thread: UnreadThreadItem): string {
    const { roomName, threadSenderName, threadPreview, notification } = thread;
    const count = notification.count;
    const isMention = notification.isMention && count > 0;

    // Without a first message there is no sender nor preview to announce, only the room.
    if (!threadPreview) {
        if (isMention) return _t("room_list|unread_threads|a11y|mention_no_thread", { roomName, count });
        if (count > 0) return _t("room_list|unread_threads|a11y|unread_no_thread", { roomName, count });
        return _t("room_list|unread_threads|a11y|default_no_thread", { roomName });
    }

    if (isMention)
        return _t("room_list|unread_threads|a11y|mention", { roomName, threadSenderName, threadPreview, count });
    if (count > 0)
        return _t("room_list|unread_threads|a11y|unread", { roomName, threadSenderName, threadPreview, count });
    return _t("room_list|unread_threads|a11y|default", { roomName, threadSenderName, threadPreview });
}

/**
 * A collapsible section of the room list that lists unread threads, above the room sections.
 *
 * A row stands for a thread rather than a room: clicking it opens the room and that thread.
 */
export const RoomListUnreadThreadsView = memo(function RoomListUnreadThreadsView({
    vm,
    renderAvatar,
}: RoomListUnreadThreadsViewProps): JSX.Element | null {
    const { isExpanded, threads, hiddenThreadCount } = useViewModel(vm);
    const title = _t("room_list|unread_threads|title");

    // Nothing unread: the section has no business taking up room at the top of the list.
    if (threads.length === 0) return null;

    return (
        <section className={styles.section} data-testid="unread-threads-section">
            <Flex
                as="button"
                className={styles.header}
                align="center"
                justify="space-between"
                gap="var(--cpd-space-2x)"
                aria-expanded={isExpanded}
                aria-controls="roomListUnreadThreadsList"
                onClick={vm.onToggleExpanded}
            >
                <Flex align="center" gap="var(--cpd-space-0-5x)">
                    <ChevronRightIcon
                        className={styles.chevron}
                        width="24px"
                        height="24px"
                        fill="var(--cpd-color-icon-secondary)"
                    />
                    <span className={styles.title}>{title}</span>
                </Flex>
                {!isExpanded && (
                    <Text as="span" size="sm" weight="regular" className={styles.count}>
                        {_t("common|n_threads", { count: threads.length })}
                    </Text>
                )}
            </Flex>

            {isExpanded && (
                <div id="roomListUnreadThreadsList" className={styles.rows} role="group" aria-label={title}>
                    {threads.map((thread) => (
                        <Flex
                            as="button"
                            key={thread.id}
                            className={styles.threadItem}
                            data-testid="unread-thread-row"
                            gap="var(--cpd-space-3x)"
                            align="stretch"
                            aria-label={getA11yLabel(thread)}
                            onClick={() => vm.onOpenThread(thread.threadId)}
                        >
                            <div className={styles.avatar}>{renderAvatar(thread.room)}</div>
                            <Flex
                                direction="column"
                                className={styles.container}
                                align="stretch"
                                justify="center"
                                gap="var(--cpd-space-0-5x)"
                            >
                                <Text as="span" size="md" weight="semibold" className={styles.roomName}>
                                    {thread.roomName}
                                </Text>
                                {(thread.threadSenderName || thread.threadPreview) && (
                                    <Text
                                        as="span"
                                        size="sm"
                                        weight="regular"
                                        className={styles.threadPreview}
                                        data-testid="thread-preview-line"
                                    >
                                        {thread.threadSenderName && (
                                            <Text as="span" size="sm" weight="medium">
                                                {`${thread.threadSenderName}: `}
                                            </Text>
                                        )}
                                        {thread.threadPreview}
                                    </Text>
                                )}
                                {(thread.latestSenderName || thread.latestPreview) && (
                                    <Text
                                        as="span"
                                        size="sm"
                                        weight="regular"
                                        className={styles.latestPreview}
                                        data-testid="latest-preview-line"
                                    >
                                        {thread.latestSenderName && (
                                            <Text as="span" size="sm" weight="medium">
                                                {`${thread.latestSenderName}: `}
                                            </Text>
                                        )}
                                        {thread.latestPreview}
                                    </Text>
                                )}
                            </Flex>
                            <div className={styles.notificationDecoration} aria-hidden={true}>
                                <NotificationDecoration {...thread.notification} />
                            </div>
                        </Flex>
                    ))}
                    {hiddenThreadCount > 0 && (
                        <Text as="div" size="sm" weight="regular" className={styles.more}>
                            {_t("room_list|unread_threads|more", { count: hiddenThreadCount })}
                        </Text>
                    )}
                </div>
            )}
        </section>
    );
});
