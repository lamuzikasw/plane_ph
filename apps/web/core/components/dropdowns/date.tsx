/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/* eslint-disable jsx-a11y/no-static-element-interactions -- ComboDropDown owns the keyboard interaction contract. */

import React, { useMemo, useRef, useState } from "react";
import { observer } from "mobx-react";
import { createPortal } from "react-dom";
import { usePopper } from "react-popper";
import { CalendarDays, Clock } from "lucide-react";
import { Combobox } from "@headlessui/react";
// ui
import type { Matcher } from "@plane/propel/calendar";
import { Calendar } from "@plane/propel/calendar";
import { CloseIcon } from "@plane/propel/icons";
import { ComboDropDown } from "@plane/ui";
import { cn, renderFormattedDate, getDate, getDateTime } from "@plane/utils";
// helpers
// hooks
import { useUserProfile } from "@/hooks/store/user";
import { useDropdown } from "@/hooks/use-dropdown";
// components
import { DropdownButton } from "./buttons";
import { applyTimeInputToDate, mergeDateAndTime } from "./date-time-input.utils";
import { TimeInput } from "./time-input";
// constants
import { BUTTON_VARIANTS_WITH_TEXT } from "./constants";
// types
import type { TDropdownProps } from "./types";

type Props = TDropdownProps & {
  clearIconClassName?: string;
  defaultOpen?: boolean;
  optionsClassName?: string;
  icon?: React.ReactNode;
  isClearable?: boolean;
  minDate?: Date;
  maxDate?: Date;
  onChange: (val: Date | null) => void;
  onClose?: () => void;
  value: Date | string | null;
  closeOnSelect?: boolean;
  formatToken?: string;
  renderByDefault?: boolean;
  labelClassName?: string;
  includeTime?: boolean;
};

export const DateDropdown = observer(function DateDropdown(props: Props) {
  const {
    buttonClassName = "",
    buttonContainerClassName,
    buttonVariant,
    className = "",
    clearIconClassName = "",
    defaultOpen = false,
    optionsClassName = "",
    closeOnSelect = true,
    disabled = false,
    hideIcon = false,
    icon = <CalendarDays className="h-3 w-3 flex-shrink-0" />,
    isClearable = true,
    minDate,
    maxDate,
    onChange,
    onClose,
    placeholder = "Date",
    placement,
    showTooltip = false,
    tabIndex,
    value,
    formatToken,
    renderByDefault = true,
    labelClassName = "",
    includeTime = false,
  } = props;
  // states
  const [isOpen, setIsOpen] = useState(defaultOpen);
  // refs
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  // hooks
  const { data } = useUserProfile();
  const startOfWeek = data?.start_of_the_week;
  // popper-js refs
  const [referenceElement, setReferenceElement] = useState<HTMLButtonElement | null>(null);
  const [popperElement, setPopperElement] = useState<HTMLDivElement | null>(null);
  // popper-js init
  const { styles, attributes } = usePopper(referenceElement, popperElement, {
    placement: placement ?? "bottom-start",
    modifiers: [
      {
        name: "preventOverflow",
        options: {
          padding: 12,
        },
      },
    ],
  });

  const isDateSelected = value && value.toString().trim() !== "";

  const onOpen = () => {
    if (referenceElement) referenceElement.focus();
  };

  const { handleClose, handleKeyDown, handleOnClick } = useDropdown({
    dropdownRef,
    isOpen,
    onClose,
    onOpen,
    setIsOpen,
  });

  const selectedDate = useMemo(() => (includeTime ? getDateTime(value) : getDate(value)), [includeTime, value]);

  const getLabel = (date: Date | string | null | undefined) => {
    if (!date) return undefined;

    if (includeTime) {
      const parsedDate = getDateTime(date);
      return parsedDate ? renderFormattedDate(parsedDate, formatToken ?? "MMM dd, yyyy HH:mm") : undefined;
    }

    return renderFormattedDate(date, formatToken);
  };

  const dropdownOnChange = (val: Date | null, shouldClose: boolean = closeOnSelect && !includeTime) => {
    onChange(val);
    if (shouldClose) {
      handleClose();
      referenceElement?.blur();
    }
  };

  const handleTimeChange = (time: string) => {
    if (!selectedDate) return;

    // The dropdown portal can unmount before blur fires, so persist a complete value immediately.
    const updatedDate = applyTimeInputToDate(selectedDate, time);
    if (updatedDate) dropdownOnChange(updatedDate, false);
  };

  const disabledDays: Matcher[] = [];
  if (minDate) disabledDays.push({ before: minDate });
  if (maxDate) disabledDays.push({ after: maxDate });

  const comboButton = (
    <button
      type="button"
      className={cn(
        "clickable block h-full max-w-full outline-none",
        {
          "cursor-not-allowed text-secondary": disabled,
          "cursor-pointer": !disabled,
        },
        buttonContainerClassName
      )}
      ref={setReferenceElement}
      onClick={handleOnClick}
      disabled={disabled}
    >
      <DropdownButton
        className={buttonClassName}
        isActive={isOpen}
        tooltipHeading={placeholder}
        tooltipContent={value ? getLabel(value) : "None"}
        showTooltip={showTooltip}
        variant={buttonVariant}
        renderToolTipByDefault={renderByDefault}
      >
        {!hideIcon && icon}
        {BUTTON_VARIANTS_WITH_TEXT.includes(buttonVariant) && (
          <span className={cn("flex-grow truncate text-left text-body-xs-medium", labelClassName)}>
            {value ? getLabel(value) : placeholder}
          </span>
        )}
        {isClearable && !disabled && isDateSelected && (
          <CloseIcon
            className={cn("h-2.5 w-2.5 flex-shrink-0", clearIconClassName)}
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              onChange(null);
            }}
          />
        )}
      </DropdownButton>
    </button>
  );

  return (
    <ComboDropDown
      as="div"
      ref={dropdownRef}
      tabIndex={tabIndex}
      className={cn("h-full", className)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          if (!isOpen) handleKeyDown(e);
        } else handleKeyDown(e);
      }}
      button={comboButton}
      disabled={disabled}
      renderByDefault={renderByDefault}
    >
      {isOpen &&
        createPortal(
          <Combobox.Options data-prevent-outside-click static>
            <div
              className={cn(
                "z-30 my-1 overflow-hidden rounded-md border-[0.5px] border-strong bg-surface-1 shadow-raised-200",
                optionsClassName
              )}
              ref={setPopperElement}
              style={styles.popper}
              {...attributes.popper}
            >
              <Calendar
                className="rounded-md border border-subtle p-3"
                captionLayout="dropdown"
                selected={selectedDate}
                defaultMonth={selectedDate}
                onSelect={(date: Date | undefined) => {
                  dropdownOnChange(date ? (includeTime ? mergeDateAndTime(date, selectedDate) : date) : null);
                }}
                showOutsideDays
                initialFocus
                disabled={disabledDays}
                mode="single"
                fixedWeeks
                weekStartsOn={startOfWeek}
              />
              {includeTime && (
                <div className="flex items-center gap-2 border-t border-subtle px-3 py-2">
                  <Clock className="h-3.5 w-3.5 flex-shrink-0 text-secondary" />
                  <TimeInput
                    ariaLabel="Time"
                    date={selectedDate}
                    onValidTimeChange={handleTimeChange}
                    disabled={!selectedDate}
                    className="focus:border-custom-primary-100 h-7 rounded border-[0.5px] border-strong bg-transparent px-2 text-body-xs-regular outline-none disabled:cursor-not-allowed disabled:text-placeholder"
                  />
                </div>
              )}
            </div>
          </Combobox.Options>,
          document.body
        )}
    </ComboDropDown>
  );
});
