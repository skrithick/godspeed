"use client";

// Adapted from the shadcn/ui New York Radix Dropdown Menu registry component.
import * as DropdownPrimitive from "@radix-ui/react-dropdown-menu";
import type { ComponentProps } from "react";

export const DropdownMenu = DropdownPrimitive.Root;
export const DropdownMenuTrigger = DropdownPrimitive.Trigger;

export function DropdownMenuContent({ className = "", sideOffset = 5, align = "end", ...props }: ComponentProps<typeof DropdownPrimitive.Content>) {
  return <DropdownPrimitive.Portal>
    <DropdownPrimitive.Content data-slot="dropdown-menu-content" className={`menu dropdown-content ${className}`}
      sideOffset={sideOffset} align={align} collisionPadding={12} {...props} />
  </DropdownPrimitive.Portal>;
}

export function DropdownMenuItem({ variant, ...props }: ComponentProps<typeof DropdownPrimitive.Item> & { variant?: "destructive" }) {
  return <DropdownPrimitive.Item data-slot="dropdown-menu-item" className="menu-item" data-destructive={variant === "destructive" || undefined} {...props} />;
}

export function DropdownMenuSeparator(props: ComponentProps<typeof DropdownPrimitive.Separator>) {
  return <DropdownPrimitive.Separator data-slot="dropdown-menu-separator" className="menu-separator" {...props} />;
}
