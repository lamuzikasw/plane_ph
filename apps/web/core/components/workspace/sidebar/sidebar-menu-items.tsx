/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import React, { useMemo } from "react";
import { observer } from "mobx-react";
import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { CalendarCheck, Ellipsis, Megaphone } from "lucide-react";
import { Disclosure, Transition } from "@headlessui/react";
// plane imports
import {
  WORKSPACE_SIDEBAR_DYNAMIC_NAVIGATION_ITEMS_LINKS,
  WORKSPACE_SIDEBAR_STATIC_NAVIGATION_ITEMS,
  WORKSPACE_SIDEBAR_STATIC_NAVIGATION_ITEMS_LINKS,
  WORKSPACE_SIDEBAR_STATIC_PINNED_NAVIGATION_ITEMS_LINKS,
} from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { ChevronRightIcon } from "@plane/propel/icons";
import { cn, joinUrlPath } from "@plane/utils";
// components
import { SidebarNavItem } from "@/components/sidebar/sidebar-navigation";
import {
  hasUnseenRelease,
  LATEST_RELEASE,
  WHATS_NEW_LAST_SEEN_STORAGE_KEY,
} from "@/components/workspace/whats-new/release-data";
// store hooks
import { useAppTheme } from "@/hooks/store/use-app-theme";
import useLocalStorage from "@/hooks/use-local-storage";
import {
  usePersonalNavigationPreferences,
  useWorkspaceNavigationPreferences,
} from "@/hooks/use-navigation-preferences";
// plane-web imports
import { SidebarItem } from "@/plane-web/components/workspace/sidebar/sidebar-item";

export const SidebarMenuItems = observer(function SidebarMenuItems() {
  // routers
  const { setValue: toggleWorkspaceMenu, storedValue: isWorkspaceMenuOpen } = useLocalStorage<boolean>(
    "is_workspace_menu_open",
    true
  );

  // store hooks
  const { isExtendedSidebarOpened, toggleExtendedSidebar } = useAppTheme();
  // router hooks
  const { workspaceSlug } = useParams();
  const pathname = usePathname();
  // hooks
  const { preferences: personalPreferences } = usePersonalNavigationPreferences();
  const { preferences: workspacePreferences } = useWorkspaceNavigationPreferences();
  // translation
  const { t } = useTranslation();

  const toggleListDisclosure = (isOpen: boolean) => {
    toggleWorkspaceMenu(isOpen);
  };
  const workspaceSlugString = workspaceSlug?.toString() ?? "";
  const todayHref = joinUrlPath(workspaceSlugString, "/today");
  const whatsNewBaseHref = joinUrlPath(workspaceSlugString, "/whats-new");
  const whatsNewHref = joinUrlPath(workspaceSlugString, `/whats-new/${LATEST_RELEASE.slug}/`);
  const { storedValue: lastSeenRelease } = useLocalStorage<string | null>(WHATS_NEW_LAST_SEEN_STORAGE_KEY, null);
  const shouldShowReleaseIndicator = hasUnseenRelease(lastSeenRelease);

  // Filter static navigation items based on personal preferences
  const filteredStaticNavigationItems = useMemo(() => {
    const items = [...WORKSPACE_SIDEBAR_STATIC_NAVIGATION_ITEMS_LINKS];
    const personalItems: Array<(typeof items)[0] & { sort_order: number }> = [];

    // Add personal items based on preferences with their sort_order
    const stickiesItem = WORKSPACE_SIDEBAR_STATIC_NAVIGATION_ITEMS["stickies"];
    if (personalPreferences.items.stickies?.enabled && stickiesItem) {
      personalItems.push({
        ...stickiesItem,
        sort_order: personalPreferences.items.stickies.sort_order,
      });
    }
    if (personalPreferences.items.your_work?.enabled && WORKSPACE_SIDEBAR_STATIC_NAVIGATION_ITEMS["your-work"]) {
      personalItems.push({
        ...WORKSPACE_SIDEBAR_STATIC_NAVIGATION_ITEMS["your-work"],
        sort_order: personalPreferences.items.your_work.sort_order,
      });
    }
    if (personalPreferences.items.drafts?.enabled && WORKSPACE_SIDEBAR_STATIC_NAVIGATION_ITEMS["drafts"]) {
      personalItems.push({
        ...WORKSPACE_SIDEBAR_STATIC_NAVIGATION_ITEMS["drafts"],
        sort_order: personalPreferences.items.drafts.sort_order,
      });
    }

    // Sort personal items by sort_order
    personalItems.sort((a, b) => a.sort_order - b.sort_order);

    // Merge static items with sorted personal items
    return [...items, ...personalItems];
  }, [personalPreferences]);

  const sortedNavigationItems = useMemo(() => {
    const items = WORKSPACE_SIDEBAR_DYNAMIC_NAVIGATION_ITEMS_LINKS.map((item) => {
      const preference = workspacePreferences.items[item.key];
      return Object.assign({}, item, { sort_order: preference ? preference.sort_order : 0 });
    });
    // eslint-disable-next-line unicorn/no-array-sort
    return items.sort((a, b) => a.sort_order - b.sort_order);
  }, [workspacePreferences]);

  return (
    <>
      <div className="flex flex-col gap-0.5">
        {filteredStaticNavigationItems.map((item) => (
          <SidebarItem key={`static_${item.key}`} item={item} />
        ))}
        <Link href={todayHref}>
          <SidebarNavItem isActive={pathname === todayHref}>
            <div className="flex items-center gap-1.5 py-[1px]">
              <CalendarCheck className="size-4 flex-shrink-0 stroke-[1.5]" />
              <p className="text-13 leading-5 font-medium">Сегодня</p>
            </div>
          </SidebarNavItem>
        </Link>
        <Link href={whatsNewHref}>
          <SidebarNavItem isActive={pathname.startsWith(whatsNewBaseHref)}>
            <div className="flex items-center gap-1.5 py-[1px]">
              <Megaphone className="size-4 flex-shrink-0 stroke-[1.5]" />
              <p className="text-13 leading-5 font-medium">Что нового?</p>
              {shouldShowReleaseIndicator && (
                <>
                  <span className="relative ml-0.5 flex size-2" aria-hidden="true">
                    <span className="absolute inline-flex size-full rounded-full bg-accent-primary opacity-40 motion-safe:animate-ping" />
                    <span className="relative inline-flex size-2 rounded-full bg-accent-primary" />
                  </span>
                  <span className="sr-only">Доступен {LATEST_RELEASE.version}</span>
                </>
              )}
            </div>
          </SidebarNavItem>
        </Link>
      </div>
      <Disclosure as="div" className="flex flex-col" defaultOpen={!!isWorkspaceMenuOpen}>
        <div className="group flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-placeholder hover:bg-layer-transparent-hover">
          <Disclosure.Button
            as="button"
            type="button"
            className="flex w-full items-center gap-1 text-left text-13 font-semibold whitespace-nowrap text-placeholder"
            onClick={() => toggleListDisclosure(!isWorkspaceMenuOpen)}
            aria-label={t(
              isWorkspaceMenuOpen
                ? "aria_labels.app_sidebar.close_workspace_menu"
                : "aria_labels.app_sidebar.open_workspace_menu"
            )}
          >
            <span className="text-13 font-semibold">{t("common.workspace")}</span>
          </Disclosure.Button>
          <div className="pointer-events-none flex items-center opacity-0 group-hover:pointer-events-auto group-hover:opacity-100">
            <Disclosure.Button
              as="button"
              type="button"
              className="flex-shrink-0 rounded-sm p-0.5 hover:bg-layer-1"
              onClick={() => toggleListDisclosure(!isWorkspaceMenuOpen)}
              aria-label={t(
                isWorkspaceMenuOpen
                  ? "aria_labels.app_sidebar.close_workspace_menu"
                  : "aria_labels.app_sidebar.open_workspace_menu"
              )}
            >
              <ChevronRightIcon
                className={cn("size-3 flex-shrink-0 transition-all", {
                  "rotate-90": isWorkspaceMenuOpen,
                })}
              />
            </Disclosure.Button>
          </div>
        </div>
        <Transition
          show={!!isWorkspaceMenuOpen}
          enter="transition duration-100 ease-out"
          enterFrom="transform scale-95 opacity-0"
          enterTo="transform scale-100 opacity-100"
          leave="transition duration-75 ease-out"
          leaveFrom="transform scale-100 opacity-100"
          leaveTo="transform scale-95 opacity-0"
        >
          {isWorkspaceMenuOpen && (
            <Disclosure.Panel as="div" className="flex flex-col gap-0.5" static>
              <>
                {WORKSPACE_SIDEBAR_STATIC_PINNED_NAVIGATION_ITEMS_LINKS.map((item) => (
                  <SidebarItem key={`static_${item.key}`} item={item} />
                ))}
                {sortedNavigationItems.map((item) => (
                  <SidebarItem key={`dynamic_${item.key}`} item={item} />
                ))}
                <SidebarNavItem>
                  <button
                    type="button"
                    onClick={() => toggleExtendedSidebar()}
                    className="flex flex-grow items-center gap-1.5 text-13 font-medium text-tertiary"
                    id="extended-sidebar-toggle"
                    aria-label={t(
                      isExtendedSidebarOpened
                        ? "aria_labels.app_sidebar.close_extended_sidebar"
                        : "aria_labels.app_sidebar.open_extended_sidebar"
                    )}
                  >
                    <Ellipsis className="size-4 flex-shrink-0" />
                    <span>{isExtendedSidebarOpened ? "Hide" : "More"}</span>
                  </button>
                </SidebarNavItem>
              </>
            </Disclosure.Panel>
          )}
        </Transition>
      </Disclosure>
    </>
  );
});
