"use client";

// Adapted from the shadcn/ui New York Radix Select registry component.
import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import type { ComponentProps } from "react";

const Select = SelectPrimitive.Root;
const SelectValue = SelectPrimitive.Value;

function SelectTrigger({ children, ...props }: ComponentProps<typeof SelectPrimitive.Trigger>) {
  return <SelectPrimitive.Trigger data-slot="select-trigger" className="select-trigger field-surface" {...props}>
    {children}
    <SelectPrimitive.Icon asChild><ChevronDown size={15} aria-hidden="true" /></SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>;
}

function SelectContent({ children, ...props }: ComponentProps<typeof SelectPrimitive.Content>) {
  return <SelectPrimitive.Portal>
    <SelectPrimitive.Content data-slot="select-content" className="menu select-content" position="popper" align="start"
      sideOffset={5} collisionPadding={12} {...props}>
      <SelectPrimitive.ScrollUpButton className="select-scroll"><ChevronUp size={14} aria-hidden="true" /></SelectPrimitive.ScrollUpButton>
      <SelectPrimitive.Viewport>{children}</SelectPrimitive.Viewport>
      <SelectPrimitive.ScrollDownButton className="select-scroll"><ChevronDown size={14} aria-hidden="true" /></SelectPrimitive.ScrollDownButton>
    </SelectPrimitive.Content>
  </SelectPrimitive.Portal>;
}

function SelectItem({ children, ...props }: ComponentProps<typeof SelectPrimitive.Item>) {
  return <SelectPrimitive.Item data-slot="select-item" className="menu-item select-item" {...props}>
    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    <SelectPrimitive.ItemIndicator className="select-indicator"><Check size={15} aria-hidden="true" /></SelectPrimitive.ItemIndicator>
  </SelectPrimitive.Item>;
}

export type Choice = { value: string; label: string; disabled?: boolean };
export const noChoice = ":none";
export function optionalChoice(value: FormDataEntryValue | null) {
  return typeof value === "string" && value && value !== noChoice ? value : null;
}

export function ChoiceSelect({ label, options, placeholder, ...props }: Pick<ComponentProps<typeof Select>, "name" | "value" | "defaultValue" | "onValueChange" | "disabled"> & {
  label: string; options: readonly Choice[]; placeholder?: string;
}) {
  return <Select {...props}>
    <SelectTrigger aria-label={label}><SelectValue data-slot="select-value" placeholder={placeholder ?? label} /></SelectTrigger>
    <SelectContent>{options.map((option) => <SelectItem key={option.value} value={option.value} disabled={option.disabled}>{option.label}</SelectItem>)}</SelectContent>
  </Select>;
}
