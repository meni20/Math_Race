import type { TeacherRoomSummary } from "./teacherTypes";

interface TeacherRoomSidebarProps {
  rooms: TeacherRoomSummary[];
  selectedRoomCode?: string;
  loading: boolean;
  onNewRoom: () => void;
  onOpenRoom: (roomCode: string) => void;
  onDeleteRoom: (roomCode: string) => void;
}

function formatDate(value: string | null) {
  if (!value) {
    return "";
  }
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function statusTone(status: TeacherRoomSummary["status"]) {
  if (status === "RACING") {
    return "border-emerald-200/25 bg-emerald-400/12 text-emerald-100";
  }
  if (status === "WAITING" || status === "CREATED" || status === "DRAFT") {
    return "border-cyan-100/25 bg-cyan-300/12 text-cyan-100";
  }
  return "border-slate-100/15 bg-white/6 text-slate-200";
}

function RoomButton({
  room,
  selected,
  onOpenRoom,
  onDeleteRoom
}: {
  room: TeacherRoomSummary;
  selected: boolean;
  onOpenRoom: (roomCode: string) => void;
  onDeleteRoom: (roomCode: string) => void;
}) {
  return (
    <div className={`rounded-lg border p-2 ${selected ? "border-cyan-100/40 bg-cyan-100/10" : "border-white/10 bg-white/5"}`}>
      <button type="button" onClick={() => onOpenRoom(room.roomCode)} className="block w-full text-left">
        <span className="block truncate text-sm font-black text-white">{room.raceName}</span>
        <span className="mt-1 flex items-center justify-between gap-2 text-[11px] uppercase tracking-[0.1em] text-cyan-100/75">
          <span>{room.roomCode}</span>
          <span className={`rounded-full border px-2 py-0.5 ${statusTone(room.status)}`}>{room.status}</span>
        </span>
        <span className="mt-1 block text-xs text-slate-300">
          {room.currentPlayers}/{room.maxPlayers} students · {formatDate(room.createdAt)}
        </span>
        {room.startedAt ? <span className="mt-1 block text-[11px] text-slate-400">Started {formatDate(room.startedAt)}</span> : null}
        {room.endedAt ? <span className="mt-1 block text-[11px] text-slate-400">Ended {formatDate(room.endedAt)}</span> : null}
      </button>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={() => onDeleteRoom(room.roomCode)}
          className="flex-1 rounded-md border border-rose-200/25 bg-rose-500/12 px-2 py-1.5 text-[10px] font-bold uppercase tracking-[0.1em] text-rose-100 transition hover:bg-rose-500/20"
        >
          Delete
        </button>
      </div>
    </div>
  );
}

export function TeacherRoomSidebar({
  rooms,
  selectedRoomCode,
  loading,
  onNewRoom,
  onOpenRoom,
  onDeleteRoom
}: TeacherRoomSidebarProps) {
  const activeRooms = rooms.filter((room) => room.status === "WAITING" || room.status === "CREATED" || room.status === "DRAFT");
  const runningRooms = rooms.filter((room) => room.status === "RACING");
  const previousRooms = rooms.filter((room) => room.status === "FINISHED" || room.status === "CLOSED");

  const renderGroup = (title: string, groupRooms: TeacherRoomSummary[]) => (
    <div className="mt-4">
      <p className="mb-2 text-[10px] font-black uppercase tracking-[0.16em] text-cyan-100/70">{title}</p>
      <div className="grid gap-2">
        {groupRooms.length === 0 ? (
          <p className="rounded-lg border border-white/10 bg-white/4 px-3 py-2 text-xs text-slate-400">No rooms</p>
        ) : groupRooms.map((room) => (
          <RoomButton
            key={room.id || room.roomCode}
            room={room}
            selected={room.roomCode === selectedRoomCode}
            onOpenRoom={onOpenRoom}
            onDeleteRoom={onDeleteRoom}
          />
        ))}
      </div>
    </div>
  );

  return (
    <aside className="shrink-0 border-b border-white/10 pb-4 lg:w-72 lg:border-b-0 lg:border-r lg:pb-0 lg:pr-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.18em] text-cyan-100/70">Rooms</p>
          <p className="mt-1 text-xs text-slate-400">{loading ? "Refreshing..." : `${rooms.length} saved`}</p>
        </div>
        <button
          type="button"
          onClick={onNewRoom}
          className="rounded-full border border-cyan-100/30 bg-cyan-300/12 px-3 py-2 text-[11px] font-black uppercase tracking-[0.12em] text-cyan-50 transition hover:bg-cyan-300/20"
        >
          New
        </button>
      </div>
      {renderGroup("Active Rooms", activeRooms)}
      {renderGroup("Running Rooms", runningRooms)}
      {renderGroup("Previous Rooms", previousRooms)}
    </aside>
  );
}
