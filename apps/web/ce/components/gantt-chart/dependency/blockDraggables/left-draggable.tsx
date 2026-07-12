/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { RefObject } from "react";
import type { IGanttBlock } from "@plane/types";
import { RightDependencyDraggable } from "./right-draggable";

type LeftDependencyDraggableProps = {
  block: IGanttBlock;
  ganttContainerRef: RefObject<HTMLDivElement>;
};

export function LeftDependencyDraggable(props: LeftDependencyDraggableProps) {
  return <RightDependencyDraggable {...props} side="left" />;
}
