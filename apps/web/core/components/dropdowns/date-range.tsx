/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/* eslint-disable jsx-a11y/no-static-element-interactions -- ComboDropDown owns the keyboard interaction contract. */

import React, { useEffect, useRef, useState } from "react";
import { ru } from "date-fns/locale";
import type { Placement } from "@popperjs/core";
import { observer } from "mobx-react";
import { createPortal } from "react-dom";
import { usePopper } from "react-popper";
import { ArrowRight, CalendarDays, Clock } from "lucide-react";
import { Combobox } from "@headlessui/react";
// plane imports
import { useTranslation } from "@plane/i18n";
// ui
import type { DateRange, Matcher } from "@plane/propel/calendar";
import { Calendar } from "@plane/propel/calendar";
import { Button } from "@plane/propel/button";
import { CloseIcon, DueDatePropertyIcon } from "@plane/propel/icons";
import { ComboDropDown } from "@plane/ui";
import { cn, renderFormattedDate } from "@plane/utils";
// helpers
// hooks
import { useUserProfile } from "@/hooks/store/user";
import { useDropdown } from "@/hooks/use-dropdown";
// components
import { DropdownButton } from "./buttons";
import { MergedDateDisplay } from "./merged-date";
import { applyTimeInputToDate, isDateTimeRangeChronological, mergeDateAndTime } from "./date-time-input.utils";
import { TimeInput } from "./time-input";
// types
import type { TButtonVariants } from "./types";

type Props = {
  applyButtonText?: string;
  bothRequired?: boolean;
  buttonClassName?: string;
  buttonContainerClassName?: string;
  buttonFromDateClassName?: string;
  buttonToDateClassName?: string;
  buttonVariant: TButtonVariants;
  cancelButtonText?: string;
  className?: string;
  clearIconClassName?: string;
  disabled?: boolean;
  hideIcon?: {
    from?: boolean;
    to?: boolean;
  };
  isClearable?: boolean;
  mergeDates?: boolean;
  minDate?: Date;
  maxDate?: Date;
  onSelect?: (range: DateRange | undefined) => void;
  placeholder?: {
    from?: string;
    to?: string;
  };
  placement?: Placement;
  required?: boolean;
  showTooltip?: boolean;
  tabIndex?: number;
  value: {
    from: Date | undefined;
    to: Date | undefined;
  };
  renderByDefault?: boolean;
  renderPlaceholder?: boolean;
  customTooltipContent?: React.ReactNode;
  customTooltipHeading?: string;
  defaultOpen?: boolean;
  renderInPortal?: boolean;
  includeTime?: boolean;
};

export const DateRangeDropdown = observer(function DateRangeDropdown(props: Props) {
  const { currentLocale, t } = useTranslation();
  const {
    buttonClassName,
    buttonContainerClassName,
    buttonFromDateClassName,
    buttonToDateClassName,
    buttonVariant,
    applyButtonText = t("common.apply"),
    cancelButtonText = t("common.cancel"),
    className,
    clearIconClassName = "",
    disabled = false,
    hideIcon = {
      from: true,
      to: true,
    },
    isClearable = false,
    mergeDates,
    minDate,
    maxDate,
    onSelect,
    placeholder = {
      from: t("project_cycles.add_date"),
      to: t("project_cycles.add_date"),
    },
    placement,
    showTooltip = false,
    tabIndex,
    value,
    renderByDefault = true,
    renderPlaceholder = true,
    customTooltipContent,
    customTooltipHeading,
    defaultOpen = false,
    renderInPortal = false,
    includeTime = false,
  } = props;
  const dateLocale = currentLocale === "ru" ? ru : undefined;
  const displayFormat = includeTime
    ? currentLocale === "ru"
      ? "dd MMM yyyy HH:mm"
      : "MMM dd, yyyy HH:mm"
    : currentLocale === "ru"
      ? "dd MMM yyyy"
      : undefined;
  // states
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const [dateRange, setDateRange] = useState<DateRange>(value);
  const fromTimestamp = value.from?.getTime();
  const toTimestamp = value.to?.getTime();
  // hooks
  const { data } = useUserProfile();
  const startOfWeek = data?.start_of_the_week;
  // refs
  const dropdownRef = useRef<HTMLDivElement | null>(null);
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

  const resetDraft = () => {
    setDateRange({
      from: fromTimestamp === undefined ? undefined : new Date(fromTimestamp),
      to: toTimestamp === undefined ? undefined : new Date(toTimestamp),
    });
  };

  const onOpen = () => {
    resetDraft();
    if (referenceElement) referenceElement.focus();
  };

  const { handleClose, handleKeyDown, handleOnClick } = useDropdown({
    dropdownRef,
    isOpen,
    onClose: resetDraft,
    onOpen,
    setIsOpen,
  });

  const disabledDays: Matcher[] = [];
  if (minDate) disabledDays.push({ before: minDate });
  if (maxDate) disabledDays.push({ after: maxDate });

  const clearDates = () => {
    const clearedRange = { from: undefined, to: undefined };
    setDateRange(clearedRange);
    onSelect?.(clearedRange);
  };

  const hasDisplayedDates = dateRange.from || dateRange.to;

  const handleRangeSelect = (range: DateRange | undefined) => {
    const updatedRange = {
      from: range?.from ? mergeDateAndTime(range.from, dateRange.from) : undefined,
      // A newly selected due date represents the whole selected day. Default
      // it to 23:59 instead of midnight so a same-day range cannot silently
      // end before a manually entered start time.
      to: range?.to ? mergeDateAndTime(range.to, dateRange.to, "end-of-day") : undefined,
    };

    setDateRange(updatedRange);
    if (!includeTime) onSelect?.(updatedRange);
  };

  const handleTimeChange = (key: "from" | "to", time: string) => {
    const currentDate = dateRange[key];
    if (!currentDate) return;

    // The dropdown portal can unmount before blur fires, so persist a complete value immediately.
    const updatedDate = applyTimeInputToDate(currentDate, time);
    if (!updatedDate) return;

    const updatedRange = { ...dateRange, [key]: updatedDate };
    setDateRange(updatedRange);
  };

  const isChronological = isDateTimeRangeChronological(dateRange.from, dateRange.to);

  const applyDateTimeRange = () => {
    if (!isChronological) return;
    onSelect?.(dateRange);
    setIsOpen(false);
    referenceElement?.blur();
  };

  useEffect(() => {
    const nextFromDate = fromTimestamp === undefined ? undefined : new Date(fromTimestamp);
    const nextToDate = toTimestamp === undefined ? undefined : new Date(toTimestamp);
    setDateRange({
      from: nextFromDate,
      to: nextToDate,
    });
  }, [fromTimestamp, toTimestamp]);

  const comboButton = (
    <button
      ref={setReferenceElement}
      type="button"
      className={cn(
        "clickable block h-full max-w-full outline-none",
        {
          "cursor-not-allowed text-secondary": disabled,
          "cursor-pointer": !disabled,
        },
        buttonContainerClassName
      )}
      onClick={handleOnClick}
      disabled={disabled}
    >
      <DropdownButton
        className={buttonClassName}
        isActive={isOpen}
        tooltipHeading={customTooltipHeading ?? t("project_cycles.date_range")}
        tooltipContent={
          <>
            {customTooltipContent ?? (
              <>
                {dateRange.from ? renderFormattedDate(dateRange.from, displayFormat, dateLocale) : ""}
                {dateRange.from && dateRange.to ? " - " : ""}
                {dateRange.to ? renderFormattedDate(dateRange.to, displayFormat, dateLocale) : ""}
              </>
            )}
          </>
        }
        showTooltip={showTooltip}
        variant={buttonVariant}
        renderToolTipByDefault={renderByDefault}
      >
        {mergeDates ? (
          // Merged date display
          <div className="flex w-full items-center gap-1.5">
            {!hideIcon.from && <CalendarDays className="h-3 w-3 flex-shrink-0" />}
            {dateRange.from || dateRange.to ? (
              <MergedDateDisplay
                startDate={dateRange.from}
                endDate={dateRange.to}
                className="flex-grow truncate text-11"
                includeTime={includeTime}
              />
            ) : (
              renderPlaceholder && (
                <>
                  <span className="text-placeholder">{placeholder.from}</span>
                  {placeholder.from && placeholder.to && (
                    <ArrowRight className="h-3 w-3 flex-shrink-0 text-placeholder" />
                  )}
                  <span className="text-placeholder">{placeholder.to}</span>
                </>
              )
            )}
            {isClearable && !disabled && hasDisplayedDates && (
              <CloseIcon
                className={cn("h-2.5 w-2.5 flex-shrink-0 cursor-pointer", clearIconClassName)}
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  clearDates();
                }}
              />
            )}
          </div>
        ) : (
          // Original separate date display
          <>
            <span
              className={cn(
                "flex h-full flex-grow items-center justify-center gap-1 rounded-xs",
                buttonFromDateClassName
              )}
            >
              {!hideIcon.from && <CalendarDays className="h-3 w-3 flex-shrink-0" />}
              {dateRange.from
                ? renderFormattedDate(dateRange.from, displayFormat, dateLocale)
                : renderPlaceholder
                  ? placeholder.from
                  : ""}
            </span>
            <ArrowRight className="h-3 w-3 flex-shrink-0" />
            <span
              className={cn(
                "flex h-full flex-grow items-center justify-center gap-1 rounded-xs",
                buttonToDateClassName
              )}
            >
              {!hideIcon.to && <DueDatePropertyIcon className="h-3 w-3 flex-shrink-0" />}
              {dateRange.to
                ? renderFormattedDate(dateRange.to, displayFormat, dateLocale)
                : renderPlaceholder
                  ? placeholder.to
                  : ""}
            </span>
            {isClearable && !disabled && hasDisplayedDates && (
              <CloseIcon
                className={cn("ml-1 h-2.5 w-2.5 flex-shrink-0 cursor-pointer", clearIconClassName)}
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  clearDates();
                }}
              />
            )}
          </>
        )}
      </DropdownButton>
    </button>
  );

  const comboOptions = (
    <Combobox.Options data-prevent-outside-click static>
      <div
        className="z-30 my-1 overflow-hidden rounded-md border-[0.5px] border-subtle-1 bg-surface-1"
        ref={setPopperElement}
        style={styles.popper}
        {...attributes.popper}
      >
        <Calendar
          locale={dateLocale}
          className="rounded-md border border-subtle p-3 text-12"
          captionLayout="dropdown"
          selected={dateRange}
          onSelect={handleRangeSelect}
          mode="range"
          disabled={disabledDays}
          showOutsideDays
          fixedWeeks
          weekStartsOn={startOfWeek}
          initialFocus
        />
        {includeTime && (
          <>
            <div className="grid grid-cols-2 gap-2 border-t border-subtle px-3 py-2">
              <div className="flex items-center gap-2 text-body-xs-regular text-secondary">
                <Clock className="h-3.5 w-3.5 flex-shrink-0" />
                <TimeInput
                  ariaLabel="Start time"
                  date={dateRange.from}
                  focusWhenEnabled={!!dateRange.from && !dateRange.to}
                  onValidTimeChange={(time) => handleTimeChange("from", time)}
                  disabled={!dateRange.from}
                  className="focus:border-custom-primary-100 min-w-0 flex-1 rounded border-[0.5px] border-strong bg-transparent px-2 py-1 text-body-xs-regular text-primary outline-none disabled:cursor-not-allowed disabled:text-placeholder"
                />
              </div>
              <div className="flex items-center gap-2 text-body-xs-regular text-secondary">
                <ArrowRight className="h-3.5 w-3.5 flex-shrink-0" />
                <TimeInput
                  ariaLabel="End time"
                  date={dateRange.to}
                  focusWhenEnabled={!!dateRange.to}
                  onValidTimeChange={(time) => handleTimeChange("to", time)}
                  disabled={!dateRange.to}
                  className="focus:border-custom-primary-100 min-w-0 flex-1 rounded border-[0.5px] border-strong bg-transparent px-2 py-1 text-body-xs-regular text-primary outline-none disabled:cursor-not-allowed disabled:text-placeholder"
                />
              </div>
            </div>
            {!isChronological && (
              <p className="px-3 pb-2 text-body-xs-regular text-danger-primary">
                End time must not be earlier than start time.
              </p>
            )}
            <div className="flex items-center justify-end gap-2 border-t border-subtle px-3 py-2">
              <Button variant="secondary" size="sm" onClick={handleClose}>
                {cancelButtonText}
              </Button>
              <Button variant="primary" size="sm" onClick={applyDateTimeRange} disabled={!isChronological}>
                {applyButtonText}
              </Button>
            </div>
          </>
        )}
      </div>
    </Combobox.Options>
  );

  const Options = renderInPortal ? createPortal(comboOptions, document.body) : comboOptions;

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
      {isOpen && Options}
    </ComboDropDown>
  );
});
