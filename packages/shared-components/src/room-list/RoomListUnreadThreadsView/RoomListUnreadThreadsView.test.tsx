/*
 * Copyright 2026 Element Creations Ltd.
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE in the repository root for full details.
 */

import { render, screen, within } from "@test-utils";
import { composeStories } from "@storybook/react-vite";
import React from "react";
import userEvent from "@testing-library/user-event";
import { describe, it, vi, beforeEach, expect } from "vitest";

import * as stories from "./RoomListUnreadThreadsView.stories";
import {
    RoomListUnreadThreadsView,
    type RoomListUnreadThreadsViewActions,
    type RoomListUnreadThreadsViewSnapshot,
} from "./RoomListUnreadThreadsView";
import { MockViewModel } from "../../core/viewmodel/MockViewModel";
import { Flex } from "../../core/utils/Flex";

const { Default, Collapsed, WithMention, WithHiddenThreads, RootOnly, WithoutThreadPreview, Empty } =
    composeStories(stories);

const onToggleExpanded = vi.fn();
const onOpenThread = vi.fn();

class TestViewModel
    extends MockViewModel<RoomListUnreadThreadsViewSnapshot>
    implements RoomListUnreadThreadsViewActions
{
    public onToggleExpanded = onToggleExpanded;
    public onOpenThread = onOpenThread;
}

describe("RoomListUnreadThreadsView", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("Storybook snapshots", () => {
        it("renders the default state", () => {
            const { container } = render(<Default />);
            expect(container).toMatchSnapshot();
        });

        it("renders the collapsed state", () => {
            const { container } = render(<Collapsed />);
            expect(container).toMatchSnapshot();
        });

        it("renders a mention", () => {
            const { container } = render(<WithMention />);
            expect(container).toMatchSnapshot();
        });

        it("renders the caption for threads the section does not show", () => {
            const { container } = render(<WithHiddenThreads />);
            expect(container).toMatchSnapshot();
        });

        it("renders a thread whose first message is unknown", () => {
            const { container } = render(<WithoutThreadPreview />);
            expect(container).toMatchSnapshot();
        });

        it("renders a thread with no replies", () => {
            const { container } = render(<RootOnly />);
            expect(container).toMatchSnapshot();
        });

        it("renders nothing with no threads", () => {
            const { container } = render(<Empty />);
            expect(container).toBeEmptyDOMElement();
        });
    });

    describe("User interactions", () => {
        const snapshot: RoomListUnreadThreadsViewSnapshot = {
            isExpanded: true,
            threads: [
                {
                    id: "!room:example.org:$thread1",
                    threadId: "$thread1",
                    room: { roomId: "!room:example.org" },
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
                },
            ],
            hiddenThreadCount: 0,
        };

        function renderView(overrides: Partial<RoomListUnreadThreadsViewSnapshot> = {}): void {
            const vm = new TestViewModel({ ...snapshot, ...overrides });
            render(<RoomListUnreadThreadsView vm={vm} renderAvatar={() => <div data-testid="avatar" />} />);
        }

        it("renders one row per thread", () => {
            renderView();
            expect(screen.getAllByTestId("unread-thread-row")).toHaveLength(1);
            expect(screen.getByRole("button", { name: /Element Web Contributors/ })).toBeInTheDocument();
        });

        it("renders no rows while collapsed", () => {
            renderView({ isExpanded: false });
            expect(screen.queryByTestId("unread-thread-row")).not.toBeInTheDocument();
            // The collapsed header names itself with the thread count next to the title.
            expect(screen.getByRole("button", { name: /^Unread threads/ })).toHaveAttribute("aria-expanded", "false");
        });

        it("calls onToggleExpanded when the header is clicked", async () => {
            const user = userEvent.setup();
            renderView();

            await user.click(screen.getByRole("button", { name: "Unread threads" }));
            expect(onToggleExpanded).toHaveBeenCalledTimes(1);
        });

        it("calls onOpenThread with the thread id when a row is clicked", async () => {
            const user = userEvent.setup();
            renderView();

            await user.click(screen.getByTestId("unread-thread-row"));
            expect(onOpenThread).toHaveBeenCalledWith("$thread1");
        });

        it("names the thread by its first message and shows the newest one", () => {
            renderView();
            const row = screen.getByTestId("unread-thread-row");
            expect(within(row).getByTestId("thread-preview-line")).toHaveTextContent(
                "Alice: Anyone tried the new room list?",
            );
            expect(within(row).getByTestId("latest-preview-line")).toHaveTextContent(
                "Bob: The new room list looks great",
            );
        });

        it("shows only the first message when the thread has no replies", () => {
            renderView({ threads: [{ ...snapshot.threads[0], latestSenderName: "", latestPreview: "" }] });
            const row = screen.getByTestId("unread-thread-row");
            expect(within(row).getByTestId("thread-preview-line")).toHaveTextContent(
                "Alice: Anyone tried the new room list?",
            );
            expect(within(row).queryByTestId("latest-preview-line")).not.toBeInTheDocument();
        });

        it("describes the thread and its count in the accessible name", () => {
            renderView();
            const label = screen.getByTestId("unread-thread-row").getAttribute("aria-label");
            expect(label).toContain("Anyone tried the new room list?");
            expect(label).toContain("3");
        });

        it("hides the notification decoration from assistive technology", () => {
            renderView();
            expect(screen.getByTestId("unread-thread-row").querySelector("[aria-hidden='true']")).toBeInTheDocument();
        });
    });

    describe("Placement in the room list", () => {
        it("spans the list so the notification sits at its trailing edge", () => {
            // RoomListView nests this section in a column Flex whose align-items resolves to start
            // through the --mx-flex-align it inherits from an ancestor Flex. A section without a
            // width of its own then shrinks to its content, and the notification lands beside the
            // text instead of at the panel edge where the room rows put theirs.
            const host = document.createElement("div");
            host.style.width = "320px";
            host.style.setProperty("--mx-flex-align", "start");
            document.body.append(host);

            render(
                <Flex direction="column">
                    <Default />
                </Flex>,
                { container: host },
            );

            const section = screen.getByTestId("unread-threads-section");
            // The Default story shows more than one thread; one row is enough to check the insets.
            const row = screen.getAllByTestId("unread-thread-row")[0];
            const rowBox = row.getBoundingClientRect();
            const avatar = row.firstElementChild!.getBoundingClientRect();
            const pill = row.lastElementChild!.getBoundingClientRect();

            expect(section.getBoundingClientRect().width).toBe(320);
            expect(rowBox.width).toBe(320);
            // Mirrored insets: the notification sits as far in from the right as the avatar does from the left.
            expect(avatar.left - rowBox.left).toBe(rowBox.right - pill.right);
        });

        it("shortens long previews instead of running under the notification", () => {
            const host = document.createElement("div");
            host.style.width = "320px";
            document.body.append(host);

            const vm = new TestViewModel({
                isExpanded: true,
                threads: [
                    {
                        id: "!room:example.org:$thread1",
                        threadId: "$thread1",
                        room: { roomId: "!room:example.org" },
                        roomName: "A room name long enough to need truncating as well",
                        threadSenderName: "Alice",
                        threadPreview: "Anyone tried the new room list? It is worth a look",
                        latestSenderName: "Bob",
                        latestPreview: "A very long message that cannot possibly fit on one line here",
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
                    },
                ],
                hiddenThreadCount: 0,
            });
            render(<RoomListUnreadThreadsView vm={vm} renderAvatar={() => <div data-testid="avatar" />} />, {
                container: host,
            });

            const row = screen.getByTestId("unread-thread-row");
            const pillLeft = (row.lastElementChild as HTMLElement).getBoundingClientRect().left;

            for (const testId of ["thread-preview-line", "latest-preview-line"]) {
                const line = within(row).getByTestId(testId);
                // The row clips the text, it does not paint it over the notification.
                expect(line.scrollWidth).toBeGreaterThan(line.clientWidth);
                expect(line.getBoundingClientRect().right).toBeLessThanOrEqual(pillLeft);
            }
        });
    });
});
