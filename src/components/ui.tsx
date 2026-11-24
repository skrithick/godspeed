"use client";

import * as Context from "@radix-ui/react-context-menu";
import * as Dialog from "@radix-ui/react-dialog";
import { BookOpen, ChevronRight, Compass, FileText, Flag, FlaskConical, Folder, Layers, PenLine, X } from "lucide-react";
import type { ComponentPropsWithRef, ReactElement, ReactNode } from "react";
import type { Page } from "@/workspace/model";
import { DropdownMenuItem } from "./primitives/dropdown-menu";
export { DropdownMenu as Menu, DropdownMenuContent as MenuContent, DropdownMenuSeparator as MenuSeparator, DropdownMenuTrigger as MenuTrigger } from "./primitives/dropdown-menu";

export const pageIcons = { file: FileText, folder: Folder, layers: Layers, book: BookOpen, compass: Compass, pen: PenLine, flask: FlaskConical, flag: Flag };

export function PageIcon({ page }: { page: Pick<Page, "glyph"> }) {
  const Icon = pageIcons[page.glyph];
  return <Icon size={16} />;
}

export function Modal({ open, onClose, title, description, children, className = "" }: {
  open: boolean; onClose: () => void; title: string; description: string; children?: ReactNode; className?: string;
}) {
  return <Dialog.Root open={open} onOpenChange={(value) => { if (!value) onClose(); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="dialog-overlay" />
      <Dialog.Content className={`dialog panel ${className}`}>
        <div className="dialog-heading">
          <div><Dialog.Title>{title}</Dialog.Title><Dialog.Description>{description}</Dialog.Description></div>
          <Dialog.Close className="icon-button" aria-label="Close"><X size={18} /></Dialog.Close>
        </div>
        {children}
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}

type MenuActionProps = { children: ReactNode; onSelect: () => void; disabled?: boolean; destructive?: boolean };
export function MenuItem({ children, onSelect, disabled, destructive }: MenuActionProps) {
  return <DropdownMenuItem variant={destructive ? "destructive" : undefined} onSelect={onSelect} disabled={disabled}>{children}</DropdownMenuItem>;
}

export function ContextMenu({ children, items, label }: { children: ReactElement; items: ReactNode; label: string }) {
  return <Context.Root>
    <Context.Trigger asChild aria-haspopup="menu" onKeyDown={(event) => {
      if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
      event.preventDefault();
      const anchor = event.target instanceof HTMLElement ? event.target : event.currentTarget;
      const bounds = anchor.getBoundingClientRect();
      anchor.dispatchEvent(new MouseEvent("contextmenu", {
        bubbles: true, cancelable: true, clientX: bounds.left + Math.min(bounds.width / 2, 18), clientY: bounds.bottom,
      }));
    }}>{children}</Context.Trigger>
    <Context.Portal><Context.Content className="menu context-menu context-menu-root" aria-label={label} collisionPadding={12}>{items}</Context.Content></Context.Portal>
  </Context.Root>;
}
export function ContextMenuItem({ children, onSelect, disabled, destructive }: MenuActionProps) {
  return <Context.Item className="menu-item" data-destructive={destructive || undefined} onSelect={onSelect} disabled={disabled}>{children}</Context.Item>;
}
export const ContextMenuSeparator = () => <Context.Separator className="menu-separator" />;
export function ContextMenuSub({ label, children }: { label: ReactNode; children: ReactNode }) {
  return <Context.Sub>
    <Context.SubTrigger className="menu-item menu-sub-trigger">{label}<ChevronRight size={14} className="menu-sub-caret" /></Context.SubTrigger>
    <Context.Portal><Context.SubContent className="menu context-menu" sideOffset={5} collisionPadding={12}>{children}</Context.SubContent></Context.Portal>
  </Context.Sub>;
}

export type TaskViewMode = "table" | "board" | "calendar";
export type Destination = { kind: "home" | "canvas" } | { kind: "tasks"; view?: TaskViewMode } | { kind: "page"; id: string; blockId?: string };
export function destinationHash(dest: Destination) {
  if (dest.kind === "page") return `#page/${dest.id}${dest.blockId ? `/${dest.blockId}` : ""}`;
  if (dest.kind === "tasks" && dest.view && dest.view !== "table") return `#tasks/${dest.view}`;
  return dest.kind === "home" ? "" : `#${dest.kind}`;
}

export function WorkspaceLink({ to, navigate, ...props }: Omit<ComponentPropsWithRef<"a">, "href" | "onClick"> & {
  to: Destination; navigate: (dest: Destination) => void;
}) {
  return <a {...props} href={destinationHash(to) || "/"} onClick={(event) => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(to);
  }} />;
}

export function readDestination(hash: string): Destination {
  const [kind, id, blockId] = hash.slice(1).split("/");
  if (kind === "page" && id && /^[\w-]+$/.test(id)) return { kind, id, blockId: blockId && /^[\w-]+$/.test(blockId) ? blockId : undefined };
  if (kind === "calendar") return { kind: "tasks", view: "calendar" };
  if (kind === "tasks") return { kind, view: id === "calendar" || id === "board" ? id : undefined };
  if (kind === "canvas") return { kind };
  return { kind: "home" };
}
