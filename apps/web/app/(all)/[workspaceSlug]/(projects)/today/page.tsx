/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { AppHeader } from "@/components/core/app-header";
import { ContentWrapper } from "@/components/core/content-wrapper";
import { PageHead } from "@/components/core/page-title";
import { WorkspaceTodayRoot } from "@/components/workspace/today";
import { WorkspaceTodayHeader } from "./header";

export default function WorkspaceTodayPage() {
  return (
    <>
      <AppHeader header={<WorkspaceTodayHeader />} />
      <ContentWrapper>
        <PageHead title="Сегодня" />
        <WorkspaceTodayRoot />
      </ContentWrapper>
    </>
  );
}
