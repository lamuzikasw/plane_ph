/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

type Props = {
  name: string;
};

export const KanbanIssueTitle = ({ name }: Props) => (
  <div className="w-full min-w-0 text-body-sm-medium break-words whitespace-normal text-primary">
    <span>{name}</span>
  </div>
);
