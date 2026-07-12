/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { CalendarCheck } from "lucide-react";

export function WorkspaceTodayHeader() {
  return (
    <div className="flex items-center gap-2 px-4">
      <CalendarCheck className="h-4 w-4 text-secondary" />
      <span className="text-14 font-medium text-primary">Сегодня</span>
    </div>
  );
}
