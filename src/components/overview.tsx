"use client";

import { Plus } from "lucide-react";
import type { Page } from "@/workspace/model";
import { PageContextMenu, type OnPageAction } from "./page-actions";
import { Trajectory } from "./trajectory";
import { PageIcon, WorkspaceLink, type Destination } from "./ui";

function timeAgo(stamp: number) {
  const hours = Math.max(0, Math.floor((Date.now() - stamp) / 3_600_000));
  if (hours < 1) return "Just now";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days < 8 ? `${days}d ago` : new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(stamp);
}

export function Overview({ pages, navigate, onNew, onPageAction }: {
  pages: Page[]; navigate: (dest: Destination) => void; onNew: () => void;
  onPageAction: OnPageAction;
}) {
  const date = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" }).format(new Date());
  const recent = pages.filter((page) => page.kind === "page").slice(0, 6);
  const byId = new Map(pages.map((page) => [page.id, page]));
  return <div className="overview content-width">
    <header className="overview-intro">
      <div className="overview-intro-content">
        <p className="overview-date">{date}</p>
        <h1>Your <em>Thinking Machine</em></h1>
        {!pages.length && <p className="overview-caption">No pages yet. Create one to start writing.</p>}
        <div className="overview-actions">
          <button className="button primary" onClick={onNew}><Plus size={17} /> New page</button>
        </div>
      </div>
      <Trajectory />
    </header>
    {recent.length > 0 && <div className="overview-layout">
      <section aria-labelledby="recent-heading" className="recent">
        <div className="section-heading"><h2 id="recent-heading">Recently edited</h2></div>
        <div className="recent-list">
          <div className="recent-columns" aria-hidden="true"><span>Name</span><span>Location</span><span>Edited</span></div>
          <ul>
            {recent.map((page) => <li key={page.id}>
              <PageContextMenu page={page} onAction={onPageAction}><WorkspaceLink className="recent-row" to={{ kind: "page", id: page.id }} navigate={navigate}>
                <span className="recent-name"><PageIcon page={page} /><span>{page.title}</span></span>
                <span className="recent-parent">{byId.get(page.parentId ?? "")?.title ?? "Workspace"}</span>
                <time dateTime={new Date(page.updatedAt).toISOString()}>{timeAgo(page.updatedAt)}</time>
              </WorkspaceLink></PageContextMenu>
            </li>)}
          </ul>
        </div>
      </section>
    </div>}
  </div>;
}
