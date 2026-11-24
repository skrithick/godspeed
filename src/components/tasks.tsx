"use client";

import { ArrowDownUp, CalendarDays, Check, ChevronLeft, ChevronRight, Columns3, Flag, ListTodo, Pencil, Plus, Search, Sparkles, Table2, Trash2 } from "lucide-react";
import { useLiveQuery } from "dexie-react-hooks";
import { useMemo, useState, type ReactElement } from "react";
import { asDate, mainDatabaseId, priorities, splitTags, statuses, today, type Database, type Page, type Property, type Task } from "@/workspace/model";
import { repo } from "@/workspace/repository";
import { ContextMenu, ContextMenuItem, ContextMenuSeparator, ContextMenuSub, Modal, type TaskViewMode } from "./ui";
import { ChoiceSelect, noChoice, optionalChoice } from "./primitives/select";

type TaskSort = "recent" | "title" | "due";
type TaskSelection = { id?: string; databaseId: string; due?: string; status?: Task["status"]; confirmDelete?: boolean };
export type { TaskSelection };
type TaskActions = {
  edit: (task: Task) => void;
  status: (task: Task, next: Task["status"]) => void;
  remove: (task: Task) => void;
};
const weekdayShort = new Intl.DateTimeFormat(undefined, { weekday: "short" });
const weekdayLong = new Intl.DateTimeFormat(undefined, { weekday: "long" });
const weekdayDates = Array.from({ length: 7 }, (_, i) => new Date(2024, 0, 1 + i));
const statusChoices = statuses.map((value) => ({ value, label: value }));
const priorityChoices = priorities.map((value) => ({ value, label: value }));
const addDatabase = ":new";

export function Status({ status }: { status: Task["status"] }) {
  return <span className="status-chip" data-status={status}><span className="status-dot" data-status={status} aria-hidden="true" />{status}</span>;
}

export function TaskView({ view, onViewChange, onEdit, notify }: {
  view: TaskViewMode; onViewChange: (view: TaskViewMode) => void; onEdit: (task: TaskSelection) => void; notify: (s: string) => void;
}) {
  const [dbId, setDbId] = useState(mainDatabaseId);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<Task["status"] | "">("");
  const [sort, setSort] = useState<TaskSort>("recent");
  const [add, setAdd] = useState<"database" | "property" | null>(null);
  const databases = useLiveQuery(() => repo.databases(), [], []);
  const tasks = useLiveQuery(() => repo.tasks(dbId, { status: status || undefined }), [dbId, status], null);
  const database = databases.find((d) => d.id === dbId);
  const items = useMemo(() => (tasks ?? []).filter((t) => `${t.title} ${t.tags.join(" ")}`.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) => sort === "title" ? a.title.localeCompare(b.title) : sort === "due" ? (a.due || "9999").localeCompare(b.due || "9999") : b.updatedAt - a.updatedAt), [tasks, query, sort]);
  const actions: TaskActions = {
    edit: (task) => onEdit({ id: task.id, databaseId: task.databaseId }),
    status: (task, next) => {
      if (task.status === next) return;
      void repo.saveTask({ status: next }, task.databaseId, task.id, task.revision)
        .then(() => notify(`Task moved to ${next.toLowerCase()}.`), (error) => notify(error instanceof Error ? error.message : "Couldn’t update the task."));
    },
    remove: (task) => onEdit({ id: task.id, databaseId: task.databaseId, confirmDelete: true }),
  };
  const create = (values: Pick<TaskSelection, "due"> = {}) => onEdit({ databaseId: dbId, status: status || undefined, ...values });
  return <div className="content-width tasks-view subview">
    <header className="view-heading">
      <div className="view-title"><h1>{database?.name ?? "My tasks"}</h1></div>
      <div className="view-heading-actions"><button className="button primary" onClick={() => create()} disabled={!database}><Plus size={17} /> New task</button></div>
    </header>
    <div className="database-toolbar">
      <div className="tabs" role="group" aria-label="Database views">
        {([{ val: "table", label: "Table", Icon: Table2 }, { val: "board", label: "Board", Icon: Columns3 }, { val: "calendar", label: "Calendar", Icon: CalendarDays }] as const).map(({ val, label, Icon }) =>
          <button key={val} className={view === val ? "selected" : ""} aria-pressed={view === val} onClick={() => onViewChange(val)}><Icon size={16} />{label}</button>)}
      </div>
      <div className="database-controls">
        <ChoiceSelect label="Database" value={dbId} onValueChange={(value) => { if (value === addDatabase) setAdd("database"); else setDbId(value); }}
          options={[...databases.map((d) => ({ value: d.id, label: d.name })), { value: addDatabase, label: "+ New database" }]} />
        <ChoiceSelect label="Filter tasks by status" value={status || noChoice} onValueChange={(value) => setStatus(value === noChoice ? "" : value as Task["status"])}
          options={[{ value: noChoice, label: "All statuses" }, ...statusChoices]} />
        <span className="toolbar-search field-surface"><Search size={15} /><input aria-label="Filter tasks by text" placeholder="Filter tasks…" value={query} onChange={(e) => setQuery(e.target.value)} /></span>
      </div>
    </div>
    {tasks === null || !database ? <div className="loading-view"><span className="spinner" /> Loading tasks…</div>
      : view === "table" ? <TaskTable tasks={items} properties={database.properties} actions={actions} sort={sort}
        onSort={setSort} filtered={Boolean(query.trim() || status)} onAddProperty={() => setAdd("property")} />
        : view === "board" ? <Board tasks={items} actions={actions} />
        : <Calendar tasks={items} actions={actions} onNew={(due) => create({ due })} />}
    {add && <DatabaseForm mode={add} database={database} close={() => setAdd(null)} onCreate={setDbId} />}
  </div>;
}

function TaskTable({ tasks, properties, actions, sort, onSort, filtered, onAddProperty }: {
  tasks: Task[]; properties: Property[]; actions: TaskActions; sort: TaskSort;
  onSort: (next: TaskSort) => void; filtered: boolean; onAddProperty: () => void;
}) {
  const todayKey = today();
  const sortHeader = (label: string, key: "title" | "due") => <th scope="col" aria-sort={sort === key ? "ascending" : undefined}>
    <button aria-pressed={sort === key} onClick={() => onSort(sort === key ? "recent" : key)}>{label}<ArrowDownUp size={12} aria-hidden="true" /></button>
  </th>;
  return <section className="task-sheet panel" aria-label="Task list">
    <div className="task-table-wrap" role="region" aria-label="Task table" tabIndex={0}>
      <table className="task-table">
        <thead><tr>{sortHeader("Task", "title")}<th scope="col">Status</th><th scope="col">Priority</th>{sortHeader("Due date", "due")}<th scope="col">Tags</th>
          {properties.map((property) => <th scope="col" key={property.id}>{property.name}</th>)}
          <th scope="col"><button className="icon-button" onClick={onAddProperty} aria-label="Add custom property" title="Add custom property"><Plus size={15} /></button></th>
        </tr></thead>
        <tbody>{tasks.map((task) => {
          const timing = task.due && task.status !== "Done" ? task.due === todayKey ? "Today" : task.due < todayKey ? "Overdue" : undefined : undefined;
          return <TaskContextMenu key={task.id} task={task} actions={actions}><tr>
            <th scope="row"><button className="table-task" onClick={() => actions.edit(task)}>{task.title}</button></th>
            <td><Status status={task.status} /></td>
            <td><span className="priority task-priority" data-priority={task.priority}><Flag size={13} aria-hidden="true" />{task.priority}</span></td>
            <td>{task.due ? <span className="task-due" data-timing={timing}><time dateTime={task.due}>{formatDue(task.due)}</time>
              {timing && <small>{timing}</small>}</span> : <span className="task-cell-empty">—</span>}</td>
            <td>{task.tags.length ? <div className="tag-line">{task.tags.map((tag) => <span className="chip tag-chip" key={tag}>{tag}</span>)}</div> : <span className="task-cell-empty">—</span>}</td>
            {properties.map((property) => {
              const value = task.properties[property.id];
              return <td key={property.id}>{typeof value === "boolean" ? (value ? "Yes" : "No") : value ?? <span className="task-cell-empty">—</span>}</td>;
            })}<td />
          </tr></TaskContextMenu>;
        })}</tbody>
      </table>
    </div>
    {tasks.length ? <p className="task-sheet-count">{tasks.length} {tasks.length === 1 ? "task" : "tasks"}{filtered ? " shown" : ""}</p>
      : <p className="empty task-sheet-empty">{filtered ? "No tasks match your filters." : "No tasks yet. Add one to start planning."}</p>}
  </section>;
}

function formatDue(due: string) {
  return due ? new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(asDate(due)) : "—";
}

function TaskContextMenu({ task, actions, children }: { task: Task; actions: TaskActions; children: ReactElement }) {
  return <ContextMenu label={`Options for ${task.title}`} items={<>
    <ContextMenuItem onSelect={() => actions.edit(task)}><Pencil size={16} /> Edit task</ContextMenuItem>
    <ContextMenuSub label={<><ListTodo size={16} /> Set status</>}>
      {statuses.map((status) => <ContextMenuItem key={status} disabled={status === task.status} onSelect={() => actions.status(task, status)}>
        {status === task.status ? <Check size={16} /> : <span className="menu-status-marker"><span className="status-dot" data-status={status} /></span>}
        {status}
      </ContextMenuItem>)}
    </ContextMenuSub>
    <ContextMenuSeparator />
    <ContextMenuItem destructive onSelect={() => actions.remove(task)}><Trash2 size={16} /> Delete task…</ContextMenuItem>
  </>}>{children}</ContextMenu>;
}

function Board({ tasks, actions }: { tasks: Task[]; actions: TaskActions }) {
  const [over, setOver] = useState<Task["status"] | null>(null);
  const mime = "application/x-godspeed-task";
  return <div className="board">{statuses.map((status) => {
    const cards = tasks.filter((t) => t.status === status);
    return <section className={`board-column ${over === status ? "drop-target" : ""}`} key={status}
      onDragOver={(e) => { if (e.dataTransfer.types.includes(mime)) { e.preventDefault(); setOver(status); } }}
      onDragLeave={(e) => { if (!(e.relatedTarget instanceof Node) || !e.currentTarget.contains(e.relatedTarget)) setOver(null); }}
      onDrop={(e) => { if (!e.dataTransfer.types.includes(mime)) return; e.preventDefault(); setOver(null); const task = tasks.find((t) => t.id === e.dataTransfer.getData(mime)); if (task) actions.status(task, status); }}>
      <header><h2><span className="status-dot" data-status={status} />{status}<small>{cards.length}</small></h2></header>
      {cards.map((task) => <TaskContextMenu key={task.id} task={task} actions={actions}>
        <button className="board-card panel" draggable onDragStart={(e) => { e.dataTransfer.setData(mime, task.id); e.dataTransfer.effectAllowed = "move"; }} onDragEnd={() => setOver(null)} onClick={() => actions.edit(task)}>
          <strong>{task.title}</strong><div><span className="priority" data-priority={task.priority}>{task.priority}</span>{task.due && <span><CalendarDays size={13} /><time dateTime={task.due}>{formatDue(task.due)}</time></span>}</div>
        </button>
      </TaskContextMenu>)}
      {!cards.length && <p className="board-empty">No tasks in this column.</p>}
    </section>;
  })}</div>;
}

function Calendar({ tasks, actions, onNew }: { tasks: Task[]; actions: TaskActions; onNew: (date: string) => void }) {
  const [cursor, setCursor] = useState(() => new Date());
  const now = new Date();
  const todayKey = today(0, now);
  const activeColumn = cursor.getMonth() === now.getMonth() && cursor.getFullYear() === now.getFullYear() ? (now.getDay() + 6) % 7 : -1;
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const offset = (first.getDay() + 6) % 7;
  const tasksByDate = new Map<string, Task[]>();
  for (const task of tasks) {
    if (!task.due) continue;
    const existing = tasksByDate.get(task.due);
    if (existing) existing.push(task);
    else tasksByDate.set(task.due, [task]);
  }
  const cells = Array.from({ length: Math.ceil((offset + new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate()) / 7) * 7 }, (_, i) => {
    const date = new Date(cursor.getFullYear(), cursor.getMonth(), 1 + i - offset);
    const key = today(0, date);
    return { date, key, tasks: tasksByDate.get(key) ?? [] };
  });
  const agenda = cells.filter(({ date, tasks }) => date.getMonth() === cursor.getMonth() && tasks.length);
  const change = (next: number) => setCursor((current) => new Date(current.getFullYear(), current.getMonth() + next, 1));
  return <section className="calendar panel" aria-label="Task calendar">
    <div className="calendar-head"><h2 aria-live="polite">{new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(cursor)}</h2>
      <div className="calendar-controls">
        <button className="button calendar-today" onClick={() => setCursor(new Date())}>Today</button>
        <div className="calendar-stepper" role="group" aria-label="Change month">
          <button className="icon-button" onClick={() => change(-1)} aria-label="Previous month"><ChevronLeft size={18} /></button>
          <button className="icon-button" onClick={() => change(1)} aria-label="Next month"><ChevronRight size={18} /></button>
        </div>
      </div>
    </div>
    <div className="calendar-weekdays">
      {weekdayDates.map((day, index) => <div className="calendar-weekday" key={index} data-current={index === activeColumn ? "" : undefined} title={weekdayLong.format(day)}>
        <span aria-hidden="true">{weekdayShort.format(day)}</span><span className="sr-only">{weekdayLong.format(day)}{index === activeColumn ? ", today" : ""}</span>
      </div>)}
    </div>
    <div className="calendar-grid">
      {cells.map(({ date, key, tasks }, index) => <div className={`calendar-cell ${date.getMonth() !== cursor.getMonth() ? "outside" : ""}`} key={key} data-weekend={index % 7 >= 5 || undefined}>
        <button className={`calendar-day ${key === todayKey ? "current" : ""}`} aria-label={`Add task on ${key}`} title={`Add task on ${key}`} aria-current={key === todayKey ? "date" : undefined} onClick={() => onNew(key)}><time dateTime={key}>{date.getDate()}</time><Plus size={13} aria-hidden="true" /></button>
        <div className="calendar-cell-tasks">{tasks.map((task) => <TaskContextMenu key={task.id} task={task} actions={actions}>
          <button className="calendar-task" title={task.title} onClick={() => actions.edit(task)}><span className="status-dot" data-status={task.status} aria-hidden="true" /><span>{task.title}</span></button>
        </TaskContextMenu>)}</div>
        {date.getMonth() === cursor.getMonth() && tasks.length > 0 && <span className="calendar-task-count" aria-hidden="true">{tasks.length}</span>}
      </div>)}
    </div>
    {agenda.length > 0 && <section className="calendar-agenda" aria-label="Tasks this month">
      <h3>Tasks this month</h3>
      {agenda.map(({ date, key, tasks }) => <div className="calendar-agenda-day" key={key}>
        <time dateTime={key}>{new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric" }).format(date)}</time>
        <ul>{tasks.map((task) => <li key={task.id}><TaskContextMenu task={task} actions={actions}>
          <button className="calendar-task" onClick={() => actions.edit(task)}><span className="status-dot" data-status={task.status} aria-hidden="true" /><span>{task.title}</span></button>
        </TaskContextMenu></li>)}</ul>
      </div>)}
    </section>}
  </section>;
}

export function TaskDialog({ selection, pages, close, ask }: { selection: TaskSelection; pages: Page[]; close: () => void; ask: (task: Task) => void }) {
  const current = useLiveQuery(async () => ({ task: selection.id ? await repo.task(selection.id) : undefined, database: await repo.database(selection.databaseId) }), [selection.id, selection.databaseId]);
  return !current ? <Modal open onClose={close} title="Task" description="Opening task details."><div className="loading-view"><span className="spinner" /> Loading…</div></Modal>
    : !current.database || (selection.id && !current.task) ? <Modal open onClose={close} title="Task not found" description="This task is no longer available." />
      : <TaskForm selection={selection} database={current.database} current={current.task} pages={pages} close={close} ask={ask} />;
}

function TaskForm({ selection, current, database, pages, close, ask }: {
  selection: TaskSelection; current?: Task; database: Database; pages: Page[]; close: () => void; ask: (task: Task) => void;
}) {
  const [task] = useState(current);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(Boolean(selection.confirmDelete));
  const [error, setError] = useState("");
  return <Modal open onClose={close} title={task ? "Task details" : "New task"} description={`A record in ${database.name}.`} className="task-dialog">
    <form className="dialog-form" onSubmit={async (e) => {
      e.preventDefault();
      const values = new FormData(e.currentTarget);
      setBusy(true); setError("");
      try {
        const properties: Task["properties"] = { ...task?.properties };
        for (const prop of database.properties) {
          const value = values.get(prop.id);
          if (prop.type === "checkbox") properties[prop.id] = value === "on";
          else if (!value) delete properties[prop.id];
          else properties[prop.id] = prop.type === "number" ? Number(value) : String(value);
        }
        await repo.saveTask({
          title: String(values.get("title") ?? ""), status: values.get("status") as Task["status"], priority: values.get("priority") as Task["priority"],
          due: String(values.get("due") ?? ""), tags: splitTags(String(values.get("tags") ?? "")), pageId: optionalChoice(values.get("pageId")), properties,
        }, database.id, task?.id, task?.revision);
        close();
      } catch (err) { setError(err instanceof Error ? err.message : "Task could not be saved."); }
      finally { setBusy(false); }
    }}>
      <label>Task name<input name="title" autoFocus={!selection.confirmDelete} required maxLength={160} defaultValue={task?.title ?? ""} placeholder="What needs doing?" /></label>
      <div className="form-grid">
        <label>Status<ChoiceSelect label="Status" name="status" defaultValue={task?.status ?? selection.status ?? "Todo"} options={statusChoices} /></label>
        <label>Priority<ChoiceSelect label="Priority" name="priority" defaultValue={task?.priority ?? "Medium"} options={priorityChoices} /></label>
        <label>Due date<input name="due" type="date" defaultValue={task?.due ?? selection.due ?? ""} /></label>
        <label>Related page<ChoiceSelect label="Related page" name="pageId" defaultValue={task?.pageId ?? noChoice}
          options={[{ value: noChoice, label: "None" }, ...pages.map((p) => ({ value: p.id, label: p.title }))]} /></label>
      </div>
      <label>Tags<input name="tags" defaultValue={task?.tags.join(", ") ?? ""} placeholder="Separate tags with commas" /></label>
      {database.properties.length > 0 && <div className="form-grid">{database.properties.map((p) => {
        const value = task?.properties[p.id];
        return p.type === "checkbox" ? <label className="check-label" key={p.id}><input type="checkbox" name={p.id} defaultChecked={value === true} /> {p.name}</label>
          : <label key={p.id}>{p.name}<input type={p.type} step={p.type === "number" ? "any" : undefined} name={p.id} defaultValue={typeof value !== "boolean" ? value : undefined} maxLength={2_000} /></label>;
      })}</div>}
      {error && <p className="form-error" role="alert">{error}</p>}
      {confirmDelete && <div className="workspace-warning"><span>Delete this task permanently?</span><button type="button" className="button danger" disabled={busy} onClick={async () => {
        if (!task) return;
        setBusy(true);
        try { await repo.removeTask(task.id, task.revision); close(); } catch (err) { setError(err instanceof Error ? err.message : "Delete failed."); } finally { setBusy(false); }
      }}>Delete task</button></div>}
      <div className="dialog-actions">
        {task && <div className="dialog-leading"><button type="button" className="icon-button" aria-label={confirmDelete ? "Hide delete confirmation" : "Show delete confirmation"} title="Delete task" onClick={() => setConfirmDelete(!confirmDelete)}><Trash2 size={17} /></button><button type="button" className="icon-button" aria-label="Ask Godspeed about this task" onClick={() => ask(task)}><Sparkles size={17} /></button></div>}
        <button type="button" className="button" autoFocus={Boolean(selection.confirmDelete)} onClick={close}>Cancel</button><button className="button primary" disabled={busy}>{task ? "Save task" : "Create task"}</button>
      </div>
    </form>
  </Modal>;
}

function DatabaseForm({ mode, database, close, onCreate }: { mode: "database" | "property"; database?: Database; close: () => void; onCreate: (id: string) => void }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return <Modal open onClose={close} title={mode === "database" ? "New database" : "Add a property"} description={mode === "database" ? "Create a separate collection of tasks and views." : "Add a field to every record in this database."}>
    <form className="dialog-form" onSubmit={async (e) => {
      e.preventDefault();
      const data = new FormData(e.currentTarget); setBusy(true); setError("");
      const name = String(data.get("name") ?? "");
      try {
        if (mode === "database") onCreate((await repo.createDatabase(name)).id);
        else if (database) await repo.addProperty(database.id, { name, type: data.get("type") as Property["type"] });
        close();
      } catch (err) { setError(err instanceof Error ? err.message : "Could not save."); }
      finally { setBusy(false); }
    }}>
      <label>Name<input name="name" required maxLength={160} autoFocus /></label>
      {mode === "property" && <label>Type<ChoiceSelect label="Type" name="type" defaultValue="text"
        options={[{ value: "text", label: "Text" }, { value: "number", label: "Number" }, { value: "checkbox", label: "Checkbox" }, { value: "date", label: "Date" }]} /></label>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="dialog-actions"><button type="button" className="button" onClick={close}>Cancel</button><button className="button primary" disabled={busy}>{mode === "database" ? "Create database" : "Add property"}</button></div>
    </form>
  </Modal>;
}
