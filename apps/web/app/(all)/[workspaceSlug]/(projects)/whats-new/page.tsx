/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { Megaphone } from "lucide-react";
import { useParams } from "next/navigation";
import { AppHeader } from "@/components/core/app-header";
import { ContentWrapper } from "@/components/core/content-wrapper";
import { PageHead } from "@/components/core/page-title";
import { WorkspaceWhatsNewRoot } from "@/components/workspace/whats-new";
import { getReleaseBySlug } from "@/components/workspace/whats-new/release-data";

export default function WorkspaceWhatsNewPage() {
  const { releaseVersion } = useParams();
  const release = getReleaseBySlug(releaseVersion?.toString());

  return (
    <>
      <AppHeader
        header={
          <div className="flex items-center gap-2 px-4">
            <Megaphone className="size-4 text-secondary" />
            <span className="text-14 font-medium text-primary">Что нового?</span>
          </div>
        }
      />
      <ContentWrapper>
        <PageHead title={`Что нового — ${release.version}`} />
        <WorkspaceWhatsNewRoot />
      </ContentWrapper>
    </>
  );
}
