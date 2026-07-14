/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { observer } from "mobx-react";
import useSWR from "swr";
// components
import { LogoSpinner } from "@/components/common/logo-spinner";
import { InstanceNotReady, MaintenanceView } from "@/components/instance";
// hooks
import { useInstance } from "@/hooks/store/use-instance";
// helpers
import { shouldShowMaintenance } from "@/services/session-reliability";

const INSTANCE_RECOVERY_WINDOW_MS = 30_000;

type TInstanceWrapper = {
  children: ReactNode;
};

const InstanceWrapper = observer(function InstanceWrapper(props: TInstanceWrapper) {
  const { children } = props;
  const [recoveryWindowElapsed, setRecoveryWindowElapsed] = useState(false);
  // store
  const { isLoading, instance, error, fetchInstanceInfo } = useInstance();

  const { isLoading: isInstanceSWRLoading, error: instanceSWRError } = useSWR(
    "INSTANCE_INFORMATION",
    async () => await fetchInstanceInfo(),
    {
      errorRetryCount: 15,
      errorRetryInterval: 2_000,
      revalidateOnFocus: false,
      shouldRetryOnError: true,
    }
  );

  useEffect(() => {
    if (!instanceSWRError || instance) {
      setRecoveryWindowElapsed(false);
      return;
    }

    const recoveryTimer = window.setTimeout(() => setRecoveryWindowElapsed(true), INSTANCE_RECOVERY_WINDOW_MS);
    return () => window.clearTimeout(recoveryTimer);
  }, [instance, instanceSWRError]);

  // loading state
  if (((isLoading || isInstanceSWRLoading) && !instance) || (instanceSWRError && !instance && !recoveryWindowElapsed))
    return (
      <div className="relative flex h-screen w-full items-center justify-center">
        <LogoSpinner />
      </div>
    );

  if (shouldShowMaintenance(Boolean(instanceSWRError), Boolean(instance), recoveryWindowElapsed))
    return <MaintenanceView />;

  // something went wrong while in the request
  if (error && error?.status === "error") return <>{children}</>;

  // instance is not ready and setup is not done
  if (instance?.is_setup_done === false) return <InstanceNotReady />;

  return <>{children}</>;
});

export default InstanceWrapper;
