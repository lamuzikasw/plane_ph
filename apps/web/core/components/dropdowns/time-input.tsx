/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import React, { useEffect, useRef } from "react";
// helpers
import { getSynchronizedTimeInputValue, getTimeInputValue, isValidTimeInput } from "./date-time-input.utils";

type Props = {
  ariaLabel: string;
  className?: string;
  date?: Date;
  disabled?: boolean;
  onValidTimeChange: (time: string) => void;
};

const stopInputEventPropagation = (event: React.SyntheticEvent<HTMLInputElement>) => {
  event.stopPropagation();
};

/**
 * Native time inputs edit hours and minutes as separate segments. Keeping the
 * input controlled makes every valid intermediate value re-render the element,
 * which resets the active segment in Chromium (typing `18` can become `08`).
 *
 * Keep the browser's editing value uncontrolled and only synchronize external
 * changes while the field is not focused. Complete values are still persisted
 * immediately, so closing a portal cannot lose a time change.
 */
export const TimeInput = ({ ariaLabel, className, date, disabled, onValidTimeChange }: Props) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const externalValue = getTimeInputValue(date);
  const lastValidValueRef = useRef(externalValue);

  useEffect(() => {
    lastValidValueRef.current = externalValue;

    const input = inputRef.current;
    if (input) {
      input.value = getSynchronizedTimeInputValue(input.value, externalValue, document.activeElement === input);
    }
  }, [externalValue]);

  return (
    <input
      ref={inputRef}
      type="time"
      aria-label={ariaLabel}
      defaultValue={externalValue}
      onChange={(event) => {
        const nextValue = event.currentTarget.value;
        if (!isValidTimeInput(nextValue)) return;

        lastValidValueRef.current = nextValue;
        onValidTimeChange(nextValue);
      }}
      onBlur={(event) => {
        if (!isValidTimeInput(event.currentTarget.value)) {
          event.currentTarget.value = lastValidValueRef.current;
        }
      }}
      onClick={stopInputEventPropagation}
      onFocus={stopInputEventPropagation}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Enter") event.currentTarget.blur();
      }}
      disabled={disabled}
      className={className}
    />
  );
};
