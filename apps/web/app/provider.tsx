/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { lazy, Suspense } from "react";
import { useTheme } from "next-themes";
import { SWRConfig } from "swr";
// Plane Imports
import { WEB_SWR_CONFIG } from "@plane/constants";
import { TranslationProvider } from "@plane/i18n";
import { Toast } from "@plane/propel/toast";
// helpers
import { resolveGeneralTheme } from "@plane/utils";
// components
import { LogoSpinner } from "@/components/common/logo-spinner";

// lazy imports
const StoreProvider = lazy(async function StoreProvider() {
  const storeContext = await import("@/lib/store-context");
  return { default: storeContext.StoreProvider };
});

const AppProgressBar = lazy(function AppProgressBar() {
  return import("@/lib/b-progress/AppProgressBar");
});

const StoreWrapper = lazy(function StoreWrapper() {
  return import("@/lib/wrappers/store-wrapper");
});

const InstanceWrapper = lazy(function InstanceWrapper() {
  return import("@/lib/wrappers/instance-wrapper");
});

export interface IAppProvider {
  children: React.ReactNode;
}

export function AppProvider(props: IAppProvider) {
  const { children } = props;
  // themes
  const { resolvedTheme } = useTheme();

  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center" role="status" aria-label="Loading application">
          <LogoSpinner />
        </div>
      }
    >
      <StoreProvider>
        <>
          <AppProgressBar />
          <TranslationProvider>
            <Toast theme={resolveGeneralTheme(resolvedTheme)} />
            <StoreWrapper>
              <InstanceWrapper>
                <Suspense>
                  <SWRConfig value={WEB_SWR_CONFIG}>{children}</SWRConfig>
                </Suspense>
              </InstanceWrapper>
            </StoreWrapper>
          </TranslationProvider>
        </>
      </StoreProvider>
    </Suspense>
  );
}
