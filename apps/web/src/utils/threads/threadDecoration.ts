/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import { type NotificationDecorationData } from "@element-hq/web-shared-components";

import { NotificationLevel } from "../../stores/notifications/NotificationLevel";

/**
 * Map a thread's unread state onto the notification decoration shared with the room list, so a
 * mention, a counted notification and bare activity are told apart by shape and not only by colour.
 *
 * The levels are mutually exclusive, mirroring {@link RoomNotificationState}'s `isMention` /
 * `isNotification` / `isActivityNotification` getters.
 *
 * @param level - the thread's notification level
 * @param count - the server-reported notification count, 0 for a local-only unread
 * @param muted - whether the thread's room is muted
 */
export function threadDecorationProps(
    level: NotificationLevel,
    count: number,
    muted: boolean,
): NotificationDecorationData {
    return {
        // Rows only exist for threads we have already decided are unread.
        hasAnyNotificationOrActivity: true,
        isMention: level === NotificationLevel.Highlight,
        isNotification: level === NotificationLevel.Notification,
        isActivityNotification: level === NotificationLevel.Activity,
        hasUnreadCount: count > 0,
        count,
        muted,
        // evaluateThreadUnread never yields NotificationLevel.Unsent, and threads can't be invites.
        isUnsentMessage: false,
        invited: false,
    };
}
