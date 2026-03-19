"use client"

export const dynamic = "force-dynamic"

import React, {
  useCallback, useEffect, useMemo, useRef, useState, useTransition,
} from "react"
import { supabase } from "@/lib/supabase"
import {
  Plus, X, Check, Calendar, Loader2, GripVertical,
  AlertCircle, Clock, Minus, Pencil, Trash2, AlertTriangle,
} from "lucide-react"

// ─── Types ───────────────────────────────────────────────────────────────────

type Status   = "todo" | "inprogress" | "done"
type Priority = "high" | "med" | "low"

interface Member {
  id: string; name: string; initials: string; color: string; bg: string
}
interface Task {
  id: string; name: string; description: string
  status: Status; priority: Priority; progress: number
  tags: string[]; due_date: string | null; order_index: number
  assignees: Member[]
}

// ─── Constants ───────────────────────────────────────────────────────────────

const COLS: { id: Status; label: string; accent: string }[] = [
  { id: "todo",       label: "รอดำเนินการ", accent: "#94a3b8" },
  { id: "inprogress", label: "กำลังทำ",     accent: "#3b82f6" },
  { id: "done",       label: "เสร็จแล้ว",   accent: "#22c55e" },
]
const TAGS = ["ออกแบบ","พัฒนา","วิจัย","การตลาด","เอกสาร","ทดสอบ"]
const PRI_CFG = {
  high: { label:"เร่งด่วน", color:"#ef4444", Icon: AlertCircle },
  med:  { label:"ปานกลาง", color:"#f59e0b", Icon: Clock },
  low:  { label:"ต่ำ",      color:"#94a3b8", Icon: Minus },
} as const
const MEM_PALETTE = [
  { color:"#534AB7", bg:"#EEEDFE" }, { color:"#0F6E56", bg:"#E1F5EE" },
  { color:"#993C1D", bg:"#FAECE7" }, { color:"#185FA5", bg:"#E6F1FB" },
  { color:"#3B6D11", bg:"#EAF3DE" },
]

// GPU-only easing — never applied to layout props
const SP = "cubic-bezier(0.34,1.56,0.64,1)"
const EZ = "cubic-bezier(0.22,1,0.36,1)"
const SM = "cubic-bezier(0.4,0,0.2,1)"

// ─── Helpers ─────────────────────────────────────────────────────────────────

function dueMeta(d: string | null) {
  if (!d) return null
  const diff = Math.ceil((new Date(d).getTime() - new Date().setHours(0,0,0,0)) / 86400000)
  return {
    label: new Date(d).toLocaleDateString("th-TH", { day:"numeric", month:"short" }),
    overdue: diff < 0,
    soon: diff >= 0 && diff <= 2,
  }
}
function uid() { return Math.random().toString(36).slice(2, 10) }

// ─── Confirm Dialog ───────────────────────────────────────────────────────────

function ConfirmDialog({
  title, message, confirmLabel = "ลบ", onConfirm, onCancel,
}: {
  title: string; message: string; confirmLabel?: string
  onConfirm: () => void; onCancel: () => void
}) {
  const [visible, setVisible] = useState(false)
  useEffect(() => { const t = requestAnimationFrame(() => setVisible(true)); return () => cancelAnimationFrame(t) }, [])

  const handleConfirm = () => { setVisible(false); setTimeout(onConfirm, 200) }
  const handleCancel  = () => { setVisible(false); setTimeout(onCancel,  200) }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center"
      style={{
        background: `rgba(0,0,0,${visible ? 0.3 : 0})`,
        backdropFilter: visible ? "blur(4px)" : "blur(0px)",
        transition: `background 200ms ${SM}, backdrop-filter 200ms ${SM}`,
      }}
      onClick={handleCancel}>
      <div
        onClick={e => e.stopPropagation()}
        style={{
          transform:  visible ? "translateY(0) scale(1)"     : "translateY(20px) scale(0.95)",
          opacity:    visible ? 1 : 0,
          transition: `transform 280ms ${SP}, opacity 220ms ${EZ}`,
          willChange: "transform, opacity",
        }}
        className="bg-white rounded-2xl border border-zinc-100 w-[340px] overflow-hidden"
        style={{ boxShadow: "0 20px 60px rgba(0,0,0,0.12), 0 4px 16px rgba(0,0,0,0.06)" }}>

        {/* Icon + content */}
        <div className="px-6 pt-6 pb-4 flex flex-col items-center text-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-red-50 flex items-center justify-center"
            style={{ animation: visible ? `iconPop 400ms ${SP} 100ms both` : "none" }}>
            <AlertTriangle className="w-5 h-5 text-red-500" />
          </div>
          <div>
            <p className="text-[15px] font-semibold text-zinc-900 mb-1">{title}</p>
            <p className="text-[13px] text-zinc-400 leading-relaxed">{message}</p>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2 px-6 pb-6">
          <button onClick={handleCancel}
            className="flex-1 py-2.5 text-[13px] font-medium text-zinc-600 border border-zinc-200 rounded-xl"
            style={{ transition: `background 120ms ${EZ}, transform 100ms ${SP}` }}
            onMouseDown={e => (e.currentTarget.style.transform = "scale(0.97)")}
            onMouseUp={e => (e.currentTarget.style.transform = "scale(1)")}>
            ยกเลิก
          </button>
          <button onClick={handleConfirm}
            className="flex-1 py-2.5 text-[13px] font-medium text-white bg-red-500 rounded-xl"
            style={{ transition: `background 120ms ${EZ}, transform 100ms ${SP}` }}
            onMouseDown={e => (e.currentTarget.style.transform = "scale(0.97)")}
            onMouseUp={e => (e.currentTarget.style.transform = "scale(1)")}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Toast notification ───────────────────────────────────────────────────────

function Toast({ message, type = "success", onDone }: {
  message: string; type?: "success" | "error"; onDone: () => void
}) {
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    requestAnimationFrame(() => setVisible(true))
    const t = setTimeout(() => { setVisible(false); setTimeout(onDone, 300) }, 2200)
    return () => clearTimeout(t)
  }, [])
  return (
    <div style={{
      position: "fixed", bottom: 24, left: "50%",
      transform: visible ? "translateX(-50%) translateY(0)" : "translateX(-50%) translateY(16px)",
      opacity: visible ? 1 : 0,
      transition: `transform 300ms ${SP}, opacity 250ms ${EZ}`,
      willChange: "transform, opacity",
      zIndex: 200,
    }}>
      <div className={`flex items-center gap-2.5 px-4 py-3 rounded-xl text-[13px] font-medium shadow-lg ${
        type === "success" ? "bg-zinc-900 text-white" : "bg-red-500 text-white"
      }`}>
        {type === "success"
          ? <Check className="w-4 h-4" />
          : <X className="w-4 h-4" />}
        {message}
      </div>
    </div>
  )
}

// ─── Main ────────────────────────────────────────────────────────────────────

export default function WorkflowPlanner() {
  const [tasks,       setTasks]       = useState<Task[]>([])
  const [members,     setMembers]     = useState<Member[]>([])
  const [selected,    setSelected]    = useState<string | null>(null)
  const [filterMem,   setFilterMem]   = useState<string | null>(null)
  const [addingCol,   setAddingCol]   = useState<Status | null>(null)
  const [loading,     setLoading]     = useState(true)
  const [memberPanel, setMemberPanel] = useState(false)
  const [confirm,     setConfirm]     = useState<{ title:string; message:string; onConfirm:()=>void } | null>(null)
  const [toast,       setToast]       = useState<{ message:string; type:"success"|"error" } | null>(null)
  const [, startT]                    = useTransition()
  const newInputRef = useRef<HTMLInputElement>(null)
  const dragId      = useRef<string | null>(null)
  const [dragState, setDragState]     = useState<{ from:string|null; over:string|null }>({ from:null, over:null })

  const showToast = useCallback((message: string, type: "success"|"error" = "success") => {
    setToast({ message, type })
  }, [])

  const askConfirm = useCallback((title: string, message: string, onConfirm: () => void) => {
    setConfirm({ title, message, onConfirm })
  }, [])

  // ── Fetch ─────────────────────────────────────────────────────────────────

  const fetchAll = useCallback(async () => {
    const [{ data: mData }, { data: tData }, { data: aData }] = await Promise.all([
      supabase.from("members").select("*").order("created_at"),
      supabase.from("tasks").select("*").order("order_index"),
      supabase.from("task_assignees").select("task_id, member_id"),
    ])
    const mems: Member[] = mData ?? []
    const map: Record<string, string[]> = {}
    ;(aData ?? []).forEach(({ task_id, member_id }: any) => {
      if (!map[task_id]) map[task_id] = []
      map[task_id].push(member_id)
    })
    startT(() => {
      setMembers(mems)
      setTasks((tData ?? []).map((t: any) => ({
        ...t,
        assignees: (map[t.id] ?? []).map((mid: string) => mems.find(m => m.id === mid)!).filter(Boolean),
      })))
      setLoading(false)
    })
  }, [])

  useEffect(() => {
    fetchAll()
    let timer: ReturnType<typeof setTimeout>
    const ch = supabase.channel("planner")
      .on("postgres_changes", { event:"*", schema:"public", table:"tasks" }, () => {
        clearTimeout(timer); timer = setTimeout(fetchAll, 400)
      })
      .on("postgres_changes", { event:"*", schema:"public", table:"task_assignees" }, () => {
        clearTimeout(timer); timer = setTimeout(fetchAll, 400)
      })
      .on("postgres_changes", { event:"*", schema:"public", table:"members" }, () => {
        clearTimeout(timer); timer = setTimeout(fetchAll, 400)
      })
      .subscribe()
    return () => { supabase.removeChannel(ch); clearTimeout(timer) }
  }, [fetchAll])

  useEffect(() => { if (addingCol) newInputRef.current?.focus() }, [addingCol])

  // ── Optimistic update ─────────────────────────────────────────────────────

  const optimisticUpdate = useCallback((id: string, patch: Partial<Task>) => {
    setTasks(prev => prev.map(t => t.id === id ? { ...t, ...patch } : t))
    const { assignees: _, ...dbPatch } = patch as any
    supabase.from("tasks").update(dbPatch).eq("id", id)
  }, [])

  // ── Create task ───────────────────────────────────────────────────────────

  const createTask = useCallback(async (colId: Status, name: string) => {
    if (!name.trim()) return
    const tempId = uid()
    const orderIdx = tasks.filter(t => t.status === colId).length
    const newTask: Task = {
      id: tempId, name: name.trim(), description: "",
      status: colId, priority: "med", progress: 0,
      tags: [], due_date: null, order_index: orderIdx, assignees: [],
    }
    setTasks(prev => [...prev, newTask])
    setAddingCol(null)
    setSelected(tempId)
    const { data, error } = await supabase.from("tasks")
      .insert({ name: name.trim(), status: colId, order_index: orderIdx })
      .select().single()
    if (data) {
      setTasks(prev => prev.map(t => t.id === tempId ? { ...t, id: data.id } : t))
      setSelected(data.id)
      showToast("เพิ่มงานแล้ว")
    } else if (error) {
      setTasks(prev => prev.filter(t => t.id !== tempId))
      showToast("เพิ่มงานไม่สำเร็จ", "error")
    }
  }, [tasks, showToast])

  // ── Delete task ───────────────────────────────────────────────────────────

  const deleteTask = useCallback((id: string, name: string) => {
    askConfirm(
      "ลบงานนี้?",
      `"${name}" จะถูกลบออกถาวร ไม่สามารถกู้คืนได้`,
      async () => {
        setTasks(prev => prev.filter(t => t.id !== id))
        if (selected === id) setSelected(null)
        const { error } = await supabase.from("tasks").delete().eq("id", id)
        if (error) {
          showToast("ลบไม่สำเร็จ", "error")
          fetchAll()
        } else {
          showToast("ลบงานแล้ว")
        }
      }
    )
  }, [selected, askConfirm, showToast, fetchAll])

  // ── Toggle assignee ───────────────────────────────────────────────────────

  const toggleAssignee = useCallback((taskId: string, memberId: string) => {
    const t = tasks.find(x => x.id === taskId)
    if (!t) return
    const has = t.assignees.some(m => m.id === memberId)
    setTasks(prev => prev.map(x => {
      if (x.id !== taskId) return x
      const assignees = has
        ? x.assignees.filter(m => m.id !== memberId)
        : [...x.assignees, members.find(m => m.id === memberId)!].filter(Boolean)
      return { ...x, assignees }
    }))
    if (has) supabase.from("task_assignees").delete().match({ task_id: taskId, member_id: memberId })
    else supabase.from("task_assignees").insert({ task_id: taskId, member_id: memberId })
  }, [tasks, members])

  // ── Member CRUD ───────────────────────────────────────────────────────────

  const addMember = useCallback(async (name: string) => {
    if (!name.trim()) return
    const p = MEM_PALETTE[members.length % MEM_PALETTE.length]
    const tmp: Member = { id: uid(), name: name.trim(), initials: name.trim().slice(0,2), ...p }
    setMembers(prev => [...prev, tmp])
    const { data } = await supabase.from("members")
      .insert({ name: name.trim(), initials: name.trim().slice(0,2), ...p }).select().single()
    if (data) {
      setMembers(prev => prev.map(m => m.id === tmp.id ? data : m))
      showToast(`เพิ่ม ${name} แล้ว`)
    }
  }, [members, showToast])

  const renameMember = useCallback(async (id: string, name: string) => {
    if (!name.trim()) return
    setMembers(prev => prev.map(m => m.id === id ? { ...m, name: name.trim(), initials: name.trim().slice(0,2) } : m))
    setTasks(prev => prev.map(t => ({
      ...t,
      assignees: t.assignees.map(a => a.id === id ? { ...a, name: name.trim(), initials: name.trim().slice(0,2) } : a),
    })))
    await supabase.from("members").update({ name: name.trim(), initials: name.trim().slice(0,2) }).eq("id", id)
    showToast("บันทึกชื่อแล้ว")
  }, [showToast])

  const deleteMember = useCallback((id: string, name: string) => {
    askConfirm(
      "ลบสมาชิก?",
      `"${name}" จะถูกลบออกและ unassign จากทุกงาน`,
      async () => {
        setMembers(prev => prev.filter(m => m.id !== id))
        setTasks(prev => prev.map(t => ({ ...t, assignees: t.assignees.filter(a => a.id !== id) })))
        if (filterMem === id) setFilterMem(null)
        await supabase.from("task_assignees").delete().eq("member_id", id)
        await supabase.from("members").delete().eq("id", id)
        showToast(`ลบ ${name} แล้ว`)
      }
    )
  }, [filterMem, askConfirm, showToast])

  // ── Drag & drop ───────────────────────────────────────────────────────────

  const onDragStart = useCallback((id: string) => {
    dragId.current = id; setDragState(s => ({ ...s, from: id }))
  }, [])
  const onDragEnter = useCallback((id: string) => {
    setDragState(s => ({ ...s, over: id }))
  }, [])
  const onDropCol = useCallback((colId: Status) => {
    const from = dragId.current; if (!from) return
    setTasks(prev => {
      const t = prev.find(x => x.id === from)
      if (!t || t.status === colId) return prev
      const updated = prev.map(x => x.id === from ? { ...x, status: colId } : x)
      supabase.from("tasks").update({ status: colId }).eq("id", from)
      return updated
    })
    dragId.current = null; setDragState({ from:null, over:null })
  }, [])
  const onDropCard = useCallback((targetId: string, colId: Status) => {
    const from = dragId.current
    if (!from || from === targetId) { setDragState({ from:null, over:null }); return }
    setTasks(prev => {
      const moving = prev.find(t => t.id === from); if (!moving) return prev
      const rest = prev.filter(t => t.id !== from)
      const idx = rest.findIndex(t => t.id === targetId)
      const reordered = [...rest.slice(0, idx + 1), { ...moving, status: colId }, ...rest.slice(idx + 1)]
      reordered.forEach((t, i) => { t.order_index = i })
      supabase.from("tasks").upsert(reordered.map(t => ({
        id: t.id, status: t.status, order_index: t.order_index,
        name: t.name, description: t.description, priority: t.priority,
        progress: t.progress, tags: t.tags, due_date: t.due_date,
      })))
      return reordered
    })
    dragId.current = null; setDragState({ from:null, over:null })
  }, [])

  // ── Derived ───────────────────────────────────────────────────────────────

  const filtered     = useMemo(() => filterMem ? tasks.filter(t => t.assignees.some(m => m.id === filterMem)) : tasks, [tasks, filterMem])
  const selectedTask = useMemo(() => tasks.find(t => t.id === selected) ?? null, [tasks, selected])
  const stats        = useMemo(() => {
    const done = tasks.filter(t => t.status === "done").length
    const total = tasks.length
    return { total, done, inprog: tasks.filter(t => t.status === "inprogress").length, urgent: tasks.filter(t => t.priority === "high" && t.status !== "done").length, pct: total ? Math.round(done / total * 100) : 0 }
  }, [tasks])

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) return (
    <div className="h-screen flex flex-col items-center justify-center gap-4 bg-[#f8f8f7]">
      <div className="w-8 h-8 rounded-xl bg-zinc-900 flex items-center justify-center"
        style={{ animation: `pulse 1.4s ${SM} infinite` }}>
        <Check className="w-4 h-4 text-white" />
      </div>
      <p className="text-[12px] text-zinc-400 tracking-wider">กำลังโหลด...</p>
    </div>
  )

  return (
    <div className="h-screen flex flex-col bg-[#f8f8f7] overflow-hidden relative"
      style={{ fontFamily: "'Geist','Inter',sans-serif" }}>

      {/* ── Confirm dialog ────────────────────────────────────────────────── */}
      {confirm && (
        <ConfirmDialog
          title={confirm.title}
          message={confirm.message}
          onConfirm={() => { confirm.onConfirm(); setConfirm(null) }}
          onCancel={() => setConfirm(null)}
        />
      )}

      {/* ── Toast ─────────────────────────────────────────────────────────── */}
      {toast && (
        <Toast message={toast.message} type={toast.type} onDone={() => setToast(null)} />
      )}

      {/* ── Top bar ───────────────────────────────────────────────────────── */}
      <header className="flex items-center justify-between px-5 py-2.5 bg-white border-b border-zinc-100">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-zinc-900 flex items-center justify-center">
            <Check className="w-3.5 h-3.5 text-white stroke-[2.5]" />
          </div>
          <span className="text-[13px] font-semibold text-zinc-900">Planner</span>
          <span className="text-[11px] text-zinc-400 hidden sm:block">Team workspace</span>
        </div>
        <div className="flex items-center gap-1.5">
          {members.map((m, i) => (
            <div key={m.id} style={{ animation: `fadeUp 300ms ${EZ} ${i * 40}ms both` }}>
              <MemberPill member={m} active={filterMem === m.id}
                onClick={() => setFilterMem(filterMem === m.id ? null : m.id)} />
            </div>
          ))}
          <button onClick={() => setMemberPanel(true)}
            className="w-7 h-7 rounded-full border border-dashed border-zinc-300 flex items-center justify-center text-zinc-400"
            style={{ transition:`border-color 150ms ${EZ}, color 150ms ${EZ}, transform 150ms ${SP}` }}
            onMouseEnter={e => (e.currentTarget.style.transform = "scale(1.1) rotate(90deg)")}
            onMouseLeave={e => (e.currentTarget.style.transform = "scale(1) rotate(0deg)")}
            title="จัดการสมาชิก">
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
      </header>

      {/* ── Member Panel ──────────────────────────────────────────────────── */}
      {memberPanel && (
        <MemberPanel members={members}
          onAdd={addMember} onRename={renameMember}
          onDelete={deleteMember} onClose={() => setMemberPanel(false)} />
      )}

      {/* ── Stats ─────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-4 gap-2.5 px-5 py-3">
        {([
          { label:"งานทั้งหมด",  val: stats.total,                    sub:"รายการ",      danger:false },
          { label:"กำลังทำ",    val: stats.inprog,                   sub:"งาน",          danger:false },
          { label:"เสร็จแล้ว",  val:`${stats.done}/${stats.total}`,  sub:`${stats.pct}%`,danger:false },
          { label:"เร่งด่วน",   val: stats.urgent,                   sub:"ค้างอยู่",    danger:stats.urgent > 0 },
        ] as const).map((s, i) => (
          <div key={s.label}
            className="bg-white border border-zinc-100 rounded-xl px-3.5 py-3 cursor-default"
            style={{
              animation: `fadeUp 0.35s ${EZ} ${i * 50}ms both`,
              transition: `transform 150ms ${SP}, box-shadow 150ms ${EZ}`,
            }}
            onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = "0 4px 16px rgba(0,0,0,0.06)" }}
            onMouseLeave={e => { e.currentTarget.style.transform = "translateY(0)";    e.currentTarget.style.boxShadow = "none" }}>
            <p className="text-[10px] text-zinc-400 mb-0.5 font-medium uppercase tracking-wide">{s.label}</p>
            <p className={`text-[22px] font-semibold leading-none tabular-nums ${s.danger ? "text-red-500" : "text-zinc-900"}`}>{s.val}</p>
            <p className="text-[10px] text-zinc-400 mt-1">{s.sub}</p>
          </div>
        ))}
      </div>

      {/* ── Board + Detail ────────────────────────────────────────────────── */}
      <div className="flex flex-1 gap-3 px-5 pb-5 overflow-hidden">
        <div className="flex gap-3 flex-1 overflow-x-auto pb-1">
          {COLS.map(col => (
            <BoardColumn key={col.id} col={col}
              tasks={filtered.filter(t => t.status === col.id).sort((a,b) => a.order_index - b.order_index)}
              selectedId={selected}
              addingHere={addingCol === col.id}
              newInputRef={addingCol === col.id ? newInputRef : undefined}
              dragState={dragState}
              onSelect={id => setSelected(selected === id ? null : id)}
              onAdd={() => setAddingCol(col.id)}
              onCancelAdd={() => setAddingCol(null)}
              onConfirmAdd={name => createTask(col.id, name)}
              onDragStart={onDragStart} onDragEnter={onDragEnter}
              onDropCol={() => onDropCol(col.id)}
              onDropCard={tid => onDropCard(tid, col.id)}
              onDelete={deleteTask} onUpdate={optimisticUpdate} />
          ))}
        </div>

        {/* Detail panel */}
        <div className="w-[272px] shrink-0" style={{
          transform:     selectedTask ? "translateX(0)"    : "translateX(20px)",
          opacity:       selectedTask ? 1 : 0,
          pointerEvents: selectedTask ? "auto" : "none",
          transition:    `transform 300ms ${SP}, opacity 220ms ${EZ}`,
          willChange:    "transform, opacity",
        }}>
          {selectedTask && (
            <DetailPanel task={selectedTask} members={members}
              onUpdate={optimisticUpdate} onToggleAssignee={toggleAssignee}
              onDelete={deleteTask} onClose={() => setSelected(null)} />
          )}
        </div>
      </div>

      <style>{`
        @keyframes fadeUp   { from { opacity:0; transform:translateY(10px) } to { opacity:1; transform:translateY(0) } }
        @keyframes cardIn   { from { opacity:0; transform:translateY(8px) scale(0.97) } to { opacity:1; transform:translateY(0) scale(1) } }
        @keyframes iconPop  { 0%{transform:scale(0) rotate(-10deg)} 60%{transform:scale(1.15) rotate(3deg)} 100%{transform:scale(1) rotate(0)} }
        @keyframes pulse    { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.6;transform:scale(0.92)} }
        @keyframes slideIn  { from{opacity:0;transform:translateX(12px)} to{opacity:1;transform:translateX(0)} }
        * { -webkit-font-smoothing:antialiased; }
        ::-webkit-scrollbar { width:4px; height:4px; }
        ::-webkit-scrollbar-thumb { background:#e4e4e7; border-radius:2px; }
        ::-webkit-scrollbar-thumb:hover { background:#d4d4d8; }
      `}</style>
    </div>
  )
}

// ─── BoardColumn ─────────────────────────────────────────────────────────────

const BoardColumn = React.memo(function BoardColumn({
  col, tasks, selectedId, addingHere, newInputRef, dragState,
  onSelect, onAdd, onCancelAdd, onConfirmAdd,
  onDragStart, onDragEnter, onDropCol, onDropCard, onDelete, onUpdate,
}: {
  col: { id: Status; label: string; accent: string }
  tasks: Task[]; selectedId: string | null
  addingHere: boolean; newInputRef?: React.RefObject<HTMLInputElement>
  dragState: { from:string|null; over:string|null }
  onSelect: (id: string) => void
  onAdd: () => void; onCancelAdd: () => void; onConfirmAdd: (n: string) => void
  onDragStart: (id: string) => void; onDragEnter: (id: string) => void
  onDropCol: () => void; onDropCard: (id: string) => void
  onDelete: (id: string, name: string) => void
  onUpdate: (id: string, p: Partial<Task>) => void
}) {
  const [newName, setNewName] = useState("")
  const isDropTarget = dragState.from && !tasks.find(t => t.id === dragState.from)
  const confirm = () => { if (newName.trim()) { onConfirmAdd(newName); setNewName("") } }
  const cancel  = () => { onCancelAdd(); setNewName("") }

  return (
    <div className="flex flex-col w-[210px] shrink-0 gap-2"
      onDragOver={e => e.preventDefault()} onDrop={onDropCol}>
      <div className="flex items-center justify-between px-1 pt-1">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full" style={{ background: col.accent, boxShadow: `0 0 0 3px ${col.accent}22` }} />
          <span className="text-[11px] font-medium text-zinc-500">{col.label}</span>
        </div>
        <span className="text-[10px] text-zinc-400 bg-zinc-100 px-1.5 py-0.5 rounded-full tabular-nums"
          style={{ transition:`background 200ms ${EZ}` }}>
          {tasks.length}
        </span>
      </div>

      <div className="flex flex-col gap-1.5 flex-1 overflow-y-auto min-h-[60px]">
        {tasks.map((t, i) => (
          <TaskCard key={t.id} task={t} col={col}
            selected={selectedId === t.id}
            isDragging={dragState.from === t.id}
            isDragOver={dragState.over === t.id}
            index={i}
            onSelect={() => onSelect(t.id)}
            onDragStart={() => onDragStart(t.id)}
            onDragEnter={() => onDragEnter(t.id)}
            onDrop={() => onDropCard(t.id)}
            onDelete={() => onDelete(t.id, t.name)}
            onUpdate={p => onUpdate(t.id, p)} />
        ))}
        {isDropTarget && (
          <div className="h-14 rounded-xl border-2 border-dashed flex items-center justify-center"
            style={{ borderColor: col.accent + "60", background: col.accent + "08",
              animation: `fadeUp 150ms ${EZ} both` }}>
            <span className="text-[11px]" style={{ color: col.accent }}>วางที่นี่</span>
          </div>
        )}
      </div>

      {addingHere ? (
        <div className="bg-white border border-zinc-200 rounded-xl p-2.5"
          style={{ animation:`cardIn 180ms ${SP} both`, boxShadow:"0 2px 8px rgba(0,0,0,0.06)" }}>
          <input ref={newInputRef} value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => { if (e.key==="Enter") confirm(); if (e.key==="Escape") cancel() }}
            placeholder="ชื่องาน..."
            className="w-full text-[13px] bg-transparent outline-none text-zinc-900 placeholder-zinc-400 mb-2" />
          <div className="flex gap-1.5">
            <button onClick={confirm}
              className="flex-1 py-1.5 bg-zinc-900 text-white text-[11px] font-medium rounded-lg"
              style={{ transition:`opacity 120ms ${EZ}, transform 100ms ${SP}` }}
              onMouseDown={e => (e.currentTarget.style.transform = "scale(0.97)")}
              onMouseUp={e => (e.currentTarget.style.transform = "scale(1)")}>
              เพิ่ม
            </button>
            <button onClick={cancel}
              className="px-2.5 py-1.5 text-zinc-400 border border-zinc-200 rounded-lg"
              style={{ transition:`background 120ms ${EZ}` }}>
              <X className="w-3 h-3" />
            </button>
          </div>
        </div>
      ) : (
        <button onClick={onAdd}
          className="flex items-center gap-1.5 px-2 py-2 rounded-xl text-[11px] text-zinc-400 border border-dashed border-zinc-200 w-full group"
          style={{ transition:`border-color 150ms ${EZ}, color 150ms ${EZ}, background 150ms ${EZ}, transform 120ms ${SP}` }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = col.accent; e.currentTarget.style.color = col.accent }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = ""; e.currentTarget.style.color = "" }}>
          <Plus className="w-3.5 h-3.5" style={{ transition:`transform 150ms ${SP}` }} />
          เพิ่มงาน
        </button>
      )}
    </div>
  )
})

// ─── TaskCard ────────────────────────────────────────────────────────────────

const TaskCard = React.memo(function TaskCard({
  task, col, selected, isDragging, isDragOver, index,
  onSelect, onDragStart, onDragEnter, onDrop, onDelete, onUpdate,
}: {
  task: Task; col: { id: Status; accent: string }
  selected: boolean; isDragging: boolean; isDragOver: boolean; index: number
  onSelect: () => void; onDragStart: () => void; onDragEnter: () => void; onDrop: () => void
  onDelete: () => void; onUpdate: (p: Partial<Task>) => void
}) {
  const [editingName, setEditingName] = useState(false)
  const [nameVal, setNameVal]         = useState(task.name)
  const nameRef = useRef<HTMLInputElement>(null)
  const due     = dueMeta(task.due_date)
  const { Icon } = PRI_CFG[task.priority]

  useEffect(() => { setNameVal(task.name) }, [task.name])
  useEffect(() => { if (editingName) nameRef.current?.focus() }, [editingName])

  const commitName = () => {
    setEditingName(false)
    if (nameVal.trim() && nameVal !== task.name) onUpdate({ name: nameVal.trim() })
    else setNameVal(task.name)
  }

  return (
    <div draggable
      onDragStart={onDragStart} onDragEnter={onDragEnter}
      onDragOver={e => e.preventDefault()}
      onDrop={e => { e.stopPropagation(); onDrop() }}
      onClick={onSelect}
      className="group relative bg-white rounded-xl cursor-pointer select-none overflow-hidden"
      style={{
        border:      selected   ? `1.5px solid #18181b` : isDragOver ? `1.5px solid ${col.accent}` : "1px solid #f1f0ef",
        opacity:     isDragging ? 0.4 : 1,
        transform:   isDragging ? "scale(0.96) rotate(-1deg)" : isDragOver ? "scale(1.02)" : "scale(1)",
        willChange:  "transform, opacity",
        boxShadow:   selected ? "0 0 0 3px rgba(24,24,27,0.07)" : isDragOver ? `0 0 0 3px ${col.accent}22` : "0 1px 3px rgba(0,0,0,0.03)",
        transition:  `transform 200ms ${SP}, opacity 150ms ${EZ}, border-color 130ms ${EZ}, box-shadow 160ms ${EZ}`,
        animation:   `cardIn 0.28s ${EZ} ${index * 35}ms both`,
        padding:     "10px 11px",
      }}>

      {/* Accent bar — animates width on hover */}
      <div className="absolute left-0 top-3 bottom-3 rounded-full"
        style={{
          background: col.accent,
          width: "3px",
          transition: `width 200ms ${SP}, opacity 150ms ${EZ}`,
        }} />

      {/* Name row */}
      <div className="flex items-start gap-1.5 pl-3 pr-1 mb-1.5">
        {editingName ? (
          <input ref={nameRef} value={nameVal}
            onChange={e => setNameVal(e.target.value)}
            onBlur={commitName}
            onKeyDown={e => { if (e.key==="Enter") commitName(); if (e.key==="Escape") { setEditingName(false); setNameVal(task.name) } }}
            onClick={e => e.stopPropagation()}
            className="flex-1 text-[12px] font-medium text-zinc-900 bg-zinc-50 border border-zinc-200 rounded-md px-1.5 py-0.5 outline-none"
            style={{ boxShadow:"0 0 0 2px rgba(24,24,27,0.06)" }}
          />
        ) : (
          <p className="flex-1 text-[12px] font-medium text-zinc-900 leading-snug line-clamp-2">{task.name}</p>
        )}

        {/* Hover actions */}
        <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100"
          style={{ transition:`opacity 150ms ${EZ}` }}
          onClick={e => e.stopPropagation()}>
          <QuickBtn title="แก้ไขชื่อ" onClick={() => setEditingName(true)}>
            <Pencil className="w-2.5 h-2.5" />
          </QuickBtn>
          <QuickBtn title="ลบงาน" danger onClick={onDelete}>
            <Trash2 className="w-2.5 h-2.5" />
          </QuickBtn>
          <span className="w-4 h-4 flex items-center justify-center cursor-grab text-zinc-300">
            <GripVertical className="w-3 h-3" />
          </span>
        </div>
      </div>

      {task.description && (
        <p className="text-[10px] text-zinc-400 leading-relaxed pl-3 mb-1.5 line-clamp-1">{task.description}</p>
      )}

      <div className="flex items-center gap-1 pl-3 flex-wrap">
        <Icon className="w-2.5 h-2.5 shrink-0" style={{ color: PRI_CFG[task.priority].color }} />
        {task.tags.slice(0,1).map(tg => (
          <span key={tg} className="text-[9px] px-1.5 py-0.5 rounded-md bg-zinc-100 text-zinc-500">{tg}</span>
        ))}
        {due && (
          <span className={`flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded-md ml-auto ${
            due.overdue ? "bg-red-50 text-red-500" : due.soon ? "bg-amber-50 text-amber-600" : "bg-zinc-100 text-zinc-500"
          }`}>
            <Calendar className="w-2 h-2" />{due.label}
          </span>
        )}
        <div className="flex ml-auto -space-x-0.5">
          {task.assignees.map(m => (
            <div key={m.id} title={m.name}
              className="w-4 h-4 rounded-full border border-white flex items-center justify-center text-[7px] font-semibold"
              style={{ background: m.bg, color: m.color, transition:`transform 150ms ${SP}` }}
              onMouseEnter={e => (e.currentTarget.style.transform = "scale(1.2) translateY(-1px)")}
              onMouseLeave={e => (e.currentTarget.style.transform = "scale(1)")}>
              {m.initials.slice(0,1)}
            </div>
          ))}
        </div>
      </div>

      {task.status !== "todo" && (
        <div className="mt-2 pl-3">
          <div className="h-1 bg-zinc-100 rounded-full overflow-hidden">
            <div className="h-full rounded-full"
              style={{ width:`${task.progress}%`, background: col.accent, transition:`width 500ms ${EZ}` }} />
          </div>
        </div>
      )}
    </div>
  )
})

// ─── QuickBtn ────────────────────────────────────────────────────────────────

function QuickBtn({ children, onClick, danger, title }: {
  children: React.ReactNode; onClick: () => void; danger?: boolean; title?: string
}) {
  return (
    <button title={title} onClick={onClick}
      className={`w-5 h-5 rounded-md flex items-center justify-center ${danger ? "text-zinc-300 hover:text-red-500 hover:bg-red-50" : "text-zinc-300 hover:text-zinc-700 hover:bg-zinc-100"}`}
      style={{ transition:`color 100ms ${EZ}, background 100ms ${EZ}, transform 100ms ${SP}` }}
      onMouseDown={e => (e.currentTarget.style.transform = "scale(0.9)")}
      onMouseUp={e => (e.currentTarget.style.transform = "scale(1)")}>
      {children}
    </button>
  )
}

// ─── MemberPill ──────────────────────────────────────────────────────────────

const MemberPill = React.memo(function MemberPill({ member: m, active, onClick }: {
  member: Member; active: boolean; onClick: () => void
}) {
  return (
    <button onClick={onClick}
      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-[11px] border ${active ? "bg-zinc-900 text-white border-zinc-900" : "bg-white text-zinc-600 border-zinc-200"}`}
      style={{ transition:`background 180ms ${EZ}, color 180ms ${EZ}, border-color 180ms ${EZ}, transform 150ms ${SP}` }}
      onMouseDown={e => (e.currentTarget.style.transform = "scale(0.95)")}
      onMouseUp={e => (e.currentTarget.style.transform = "scale(1)")}>
      <span className="w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-semibold shrink-0"
        style={{ background: m.bg, color: m.color }}>{m.initials}</span>
      {m.name}
    </button>
  )
})

// ─── DetailPanel ─────────────────────────────────────────────────────────────

const DetailPanel = React.memo(function DetailPanel({
  task, members, onUpdate, onToggleAssignee, onDelete, onClose,
}: {
  task: Task; members: Member[]
  onUpdate: (id: string, p: Partial<Task>) => void
  onToggleAssignee: (taskId: string, memberId: string) => void
  onDelete: (id: string, name: string) => void
  onClose: () => void
}) {
  const [name,    setName]    = useState(task.name)
  const [desc,    setDesc]    = useState(task.description)
  const [due,     setDue]     = useState(task.due_date ?? "")
  const [showDue, setShowDue] = useState(!!task.due_date)

  useEffect(() => {
    setName(task.name); setDesc(task.description)
    setDue(task.due_date ?? ""); setShowDue(!!task.due_date)
  }, [task.id])

  const save = useCallback(() => {
    onUpdate(task.id, { name, description: desc, due_date: due || null })
  }, [task.id, name, desc, due, onUpdate])

  const up = useCallback((patch: Partial<Task>) => onUpdate(task.id, patch), [task.id, onUpdate])

  const col = COLS.find(c => c.id === task.status)!

  return (
    <div className="flex flex-col h-full bg-white border border-zinc-100 rounded-2xl overflow-hidden"
      style={{ animation:`slideIn 280ms ${SP} both`, boxShadow:"0 2px 12px rgba(0,0,0,0.05)" }}>

      {/* Head */}
      <div className="flex items-start justify-between gap-2 px-4 pt-4 pb-3 border-b border-zinc-100">
        <div className="flex-1 min-w-0">
          <input value={name} onChange={e => setName(e.target.value)} onBlur={save}
            className="w-full text-[13px] font-semibold text-zinc-900 bg-transparent outline-none leading-snug"
            style={{ transition:`color 150ms ${EZ}` }} />
          <div className="flex items-center gap-2 mt-1">
            <div className="w-1.5 h-1.5 rounded-full" style={{ background: col.accent }} />
            <p className="text-[10px] text-zinc-400">{col.label}</p>
            <p className="text-[10px] text-zinc-300 font-mono">#{task.id.slice(0,6)}</p>
          </div>
        </div>
        <button onClick={onClose}
          className="w-6 h-6 flex items-center justify-center rounded-lg text-zinc-400 shrink-0"
          style={{ transition:`background 100ms ${EZ}, transform 150ms ${SP}` }}
          onMouseEnter={e => (e.currentTarget.style.transform = "rotate(90deg)")}
          onMouseLeave={e => (e.currentTarget.style.transform = "rotate(0deg)")}>
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-4">

        <FG label="รายละเอียด">
          <textarea value={desc} onChange={e => setDesc(e.target.value)} onBlur={save}
            placeholder="เพิ่มรายละเอียด..." rows={3}
            className="w-full text-[12px] text-zinc-700 bg-zinc-50 border border-zinc-100 rounded-lg p-2.5 outline-none resize-none placeholder-zinc-400"
            style={{ transition:`border-color 150ms ${EZ}, box-shadow 150ms ${EZ}` }}
            onFocus={e => { e.currentTarget.style.borderColor="#d4d4d8"; e.currentTarget.style.boxShadow="0 0 0 3px rgba(24,24,27,0.04)" }}
            onBlurCapture={e => { e.currentTarget.style.borderColor=""; e.currentTarget.style.boxShadow="" }} />
        </FG>

        <FG label="สถานะ">
          <div className="grid grid-cols-3 gap-1">
            {COLS.map(c => (
              <Seg key={c.id} active={task.status === c.id} accent={c.accent}
                onClick={() => up({ status: c.id, progress: c.id==="done"?100:c.id==="todo"?0:task.progress })}>
                {c.label}
              </Seg>
            ))}
          </div>
        </FG>

        <FG label="ความสำคัญ">
          <div className="grid grid-cols-3 gap-1">
            {(["high","med","low"] as Priority[]).map(p => {
              const cfg = PRI_CFG[p]; const act = task.priority === p
              return (
                <button key={p} onClick={() => up({ priority: p })}
                  className="flex items-center justify-center gap-1 py-1.5 rounded-lg text-[11px] font-medium border"
                  style={{
                    background:  act ? cfg.color+"18" : "transparent",
                    borderColor: act ? cfg.color+"50" : "#f1f0ef",
                    color:       act ? cfg.color : "#a1a1aa",
                    transition:  `background 160ms ${EZ}, border-color 160ms ${EZ}, color 160ms ${EZ}, transform 120ms ${SP}`,
                  }}
                  onMouseDown={e => (e.currentTarget.style.transform = "scale(0.96)")}
                  onMouseUp={e => (e.currentTarget.style.transform = "scale(1)")}>
                  <cfg.Icon className="w-3 h-3" />{cfg.label}
                </button>
              )
            })}
          </div>
        </FG>

        <FG label="ผู้รับผิดชอบ">
          <div className="flex flex-wrap gap-1.5">
            {members.map(m => {
              const assigned = task.assignees.some(a => a.id === m.id)
              return (
                <button key={m.id} onClick={() => onToggleAssignee(task.id, m.id)}
                  className="flex items-center gap-1.5 px-2 py-1 rounded-full text-[11px] border"
                  style={{
                    background:  assigned ? m.bg : "transparent",
                    borderColor: assigned ? m.color+"60" : "#f1f0ef",
                    color:       assigned ? m.color : "#a1a1aa",
                    transition:  `background 160ms ${EZ}, border-color 160ms ${EZ}, color 160ms ${EZ}, transform 120ms ${SP}`,
                  }}
                  onMouseDown={e => (e.currentTarget.style.transform = "scale(0.95)")}
                  onMouseUp={e => (e.currentTarget.style.transform = "scale(1)")}>
                  <span className="w-3.5 h-3.5 rounded-full flex items-center justify-center text-[7px] font-semibold"
                    style={{ background: m.bg, color: m.color }}>{m.initials}</span>
                  {m.name}
                  {assigned && <Check className="w-2.5 h-2.5 ml-0.5" style={{ animation:`iconPop 250ms ${SP} both` }} />}
                </button>
              )
            })}
          </div>
        </FG>

        <FG label="กำหนดเสร็จ">
          {showDue ? (
            <div className="flex items-center gap-2">
              <Calendar className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
              <input type="date" value={due}
                onChange={e => { setDue(e.target.value); up({ due_date: e.target.value||null }) }}
                className="flex-1 text-[12px] text-zinc-700 bg-zinc-50 border border-zinc-100 rounded-lg px-2.5 py-1.5 outline-none"
                style={{ transition:`border-color 150ms ${EZ}` }} />
              <button onClick={() => { setShowDue(false); setDue(""); up({ due_date: null }) }}
                className="text-zinc-400"
                style={{ transition:`color 100ms ${EZ}, transform 150ms ${SP}` }}
                onMouseEnter={e => (e.currentTarget.style.transform = "rotate(90deg)")}
                onMouseLeave={e => (e.currentTarget.style.transform = "rotate(0deg)")}>
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <button onClick={() => setShowDue(true)}
              className="flex items-center gap-1.5 text-[11px] text-zinc-400 border border-dashed border-zinc-200 rounded-lg px-2.5 py-1.5 w-full"
              style={{ transition:`border-color 150ms ${EZ}, color 150ms ${EZ}, background 150ms ${EZ}` }}
              onMouseEnter={e => { e.currentTarget.style.borderColor="#94a3b8"; e.currentTarget.style.color="#64748b" }}
              onMouseLeave={e => { e.currentTarget.style.borderColor=""; e.currentTarget.style.color="" }}>
              <Calendar className="w-3 h-3" /> กำหนดวันเสร็จ
            </button>
          )}
        </FG>

        {task.status !== "todo" && (
          <FG label={`ความคืบหน้า — ${task.progress}%`}>
            <div className="relative">
              <input type="range" min="0" max="100" step="5" value={task.progress}
                onChange={e => up({ progress: Number(e.target.value) })}
                className="w-full accent-zinc-900" />
              <div className="h-1 bg-zinc-100 rounded-full mt-1 overflow-hidden">
                <div className="h-full rounded-full"
                  style={{ width:`${task.progress}%`, background: col.accent, transition:`width 400ms ${EZ}` }} />
              </div>
            </div>
          </FG>
        )}

        <FG label="หมวดหมู่">
          <div className="flex flex-wrap gap-1">
            {TAGS.map(tg => {
              const act = task.tags.includes(tg)
              return (
                <button key={tg}
                  onClick={() => up({ tags: act ? task.tags.filter(t=>t!==tg) : [...task.tags, tg] })}
                  className="text-[10px] px-2.5 py-1 rounded-full border"
                  style={{
                    background:  act ? "#18181b" : "transparent",
                    color:       act ? "#fff" : "#a1a1aa",
                    borderColor: act ? "#18181b" : "#f1f0ef",
                    transition:  `background 160ms ${EZ}, color 160ms ${EZ}, border-color 160ms ${EZ}, transform 120ms ${SP}`,
                  }}
                  onMouseDown={e => (e.currentTarget.style.transform = "scale(0.94)")}
                  onMouseUp={e => (e.currentTarget.style.transform = "scale(1)")}>
                  {tg}
                </button>
              )
            })}
          </div>
        </FG>
      </div>

      <div className="flex gap-2 px-4 py-3 border-t border-zinc-100">
        <button onClick={() => onDelete(task.id, task.name)}
          className="px-3 py-2 text-[11px] text-red-400 border border-red-100 rounded-xl flex items-center gap-1.5"
          style={{ transition:`background 120ms ${EZ}, color 120ms ${EZ}, transform 100ms ${SP}` }}
          onMouseEnter={e => { e.currentTarget.style.background="#fef2f2"; e.currentTarget.style.color="#ef4444" }}
          onMouseLeave={e => { e.currentTarget.style.background=""; e.currentTarget.style.color="" }}
          onMouseDown={e => (e.currentTarget.style.transform = "scale(0.96)")}
          onMouseUp={e => (e.currentTarget.style.transform = "scale(1)")}>
          <Trash2 className="w-3.5 h-3.5" /> ลบงาน
        </button>
        <button onClick={save}
          className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-zinc-900 text-white text-[12px] font-medium rounded-xl"
          style={{ transition:`opacity 120ms ${EZ}, transform 120ms ${SP}` }}
          onMouseDown={e => (e.currentTarget.style.transform = "scale(0.97)")}
          onMouseUp={e => (e.currentTarget.style.transform = "scale(1)")}>
          <Check className="w-3.5 h-3.5" /> บันทึก
        </button>
      </div>
    </div>
  )
})

// ─── MemberPanel ─────────────────────────────────────────────────────────────

function MemberPanel({ members, onAdd, onRename, onDelete, onClose }: {
  members: Member[]
  onAdd: (name: string) => void
  onRename: (id: string, name: string) => void
  onDelete: (id: string, name: string) => void
  onClose: () => void
}) {
  const [newName,   setNewName]   = useState("")
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editVal,   setEditVal]   = useState("")
  const [visible,   setVisible]   = useState(false)
  const newRef  = useRef<HTMLInputElement>(null)
  const editRef = useRef<HTMLInputElement>(null)

  useEffect(() => { requestAnimationFrame(() => setVisible(true)); newRef.current?.focus() }, [])
  useEffect(() => { if (editingId) editRef.current?.focus() }, [editingId])

  const commitEdit = () => {
    if (editingId) { onRename(editingId, editVal); setEditingId(null) }
  }
  const submitNew = () => {
    if (newName.trim()) { onAdd(newName.trim()); setNewName("") }
  }
  const handleClose = () => { setVisible(false); setTimeout(onClose, 200) }

  return (
    <div className="absolute inset-0 z-50 flex items-start justify-end pt-14 pr-5"
      style={{
        background: `rgba(0,0,0,${visible ? 0.15 : 0})`,
        backdropFilter: visible ? "blur(3px)" : "blur(0px)",
        transition: `background 200ms ${SM}, backdrop-filter 200ms ${SM}`,
      }}
      onClick={handleClose}>
      <div
        className="w-[300px] bg-white rounded-2xl border border-zinc-100 overflow-hidden"
        style={{
          transform:  visible ? "translateY(0) scale(1)"     : "translateY(-10px) scale(0.97)",
          opacity:    visible ? 1 : 0,
          transition: `transform 280ms ${SP}, opacity 220ms ${EZ}`,
          boxShadow:  "0 12px 40px rgba(0,0,0,0.10), 0 2px 8px rgba(0,0,0,0.05)",
          willChange: "transform, opacity",
        }}
        onClick={e => e.stopPropagation()}>

        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-100">
          <span className="text-[13px] font-semibold text-zinc-900">สมาชิกในทีม</span>
          <button onClick={handleClose}
            className="w-6 h-6 flex items-center justify-center rounded-lg text-zinc-400"
            style={{ transition:`background 100ms ${EZ}, transform 150ms ${SP}` }}
            onMouseEnter={e => (e.currentTarget.style.transform = "rotate(90deg)")}
            onMouseLeave={e => (e.currentTarget.style.transform = "rotate(0deg)")}>
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="max-h-[320px] overflow-y-auto">
          {members.map((m, i) => (
            <div key={m.id}
              className="group flex items-center gap-3 px-4 py-2.5 border-b border-zinc-50"
              style={{ animation:`fadeUp 200ms ${EZ} ${i * 30}ms both`, transition:`background 100ms ${EZ}` }}
              onMouseEnter={e => (e.currentTarget.style.background = "#fafaf9")}
              onMouseLeave={e => (e.currentTarget.style.background = "")}>
              <div className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-semibold shrink-0"
                style={{ background: m.bg, color: m.color }}>{m.initials}</div>

              {editingId === m.id ? (
                <input ref={editRef} value={editVal}
                  onChange={e => setEditVal(e.target.value)}
                  onBlur={commitEdit}
                  onKeyDown={e => { if (e.key==="Enter") commitEdit(); if (e.key==="Escape") setEditingId(null) }}
                  className="flex-1 text-[13px] text-zinc-900 bg-zinc-50 border border-zinc-200 rounded-lg px-2 py-1 outline-none"
                  style={{ boxShadow:"0 0 0 2px rgba(24,24,27,0.05)" }}
                />
              ) : (
                <span className="flex-1 text-[13px] text-zinc-800">{m.name}</span>
              )}

              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100"
                style={{ transition:`opacity 120ms ${EZ}` }}>
                <button onClick={() => { setEditingId(m.id); setEditVal(m.name) }} title="แก้ไขชื่อ"
                  className="w-6 h-6 flex items-center justify-center rounded-md text-zinc-300 hover:text-zinc-600 hover:bg-zinc-100"
                  style={{ transition:`color 100ms ${EZ}, background 100ms ${EZ}, transform 100ms ${SP}` }}
                  onMouseDown={e => (e.currentTarget.style.transform = "scale(0.9)")}
                  onMouseUp={e => (e.currentTarget.style.transform = "scale(1)")}>
                  <Pencil className="w-3 h-3" />
                </button>
                <button onClick={() => onDelete(m.id, m.name)} title="ลบสมาชิก"
                  className="w-6 h-6 flex items-center justify-center rounded-md text-zinc-300 hover:text-red-500 hover:bg-red-50"
                  style={{ transition:`color 100ms ${EZ}, background 100ms ${EZ}, transform 100ms ${SP}` }}
                  onMouseDown={e => (e.currentTarget.style.transform = "scale(0.9)")}
                  onMouseUp={e => (e.currentTarget.style.transform = "scale(1)")}>
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-2 px-4 py-3 bg-zinc-50 border-t border-zinc-100">
          <div className="w-8 h-8 rounded-full border-2 border-dashed border-zinc-300 flex items-center justify-center shrink-0">
            <Plus className="w-3.5 h-3.5 text-zinc-400" />
          </div>
          <input ref={newRef} value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => { if (e.key==="Enter") submitNew() }}
            placeholder="ชื่อสมาชิกใหม่..."
            className="flex-1 text-[13px] bg-transparent outline-none text-zinc-900 placeholder-zinc-400" />
          <button onClick={submitNew}
            className="px-3 py-1.5 bg-zinc-900 text-white text-[11px] font-medium rounded-lg"
            style={{ transition:`opacity 120ms ${EZ}, transform 100ms ${SP}` }}
            onMouseDown={e => (e.currentTarget.style.transform = "scale(0.95)")}
            onMouseUp={e => (e.currentTarget.style.transform = "scale(1)")}>
            เพิ่ม
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Micro ───────────────────────────────────────────────────────────────────

function FG({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider mb-1.5">{label}</p>
      {children}
    </div>
  )
}

function Seg({ active, accent, onClick, children }: {
  active: boolean; accent: string; onClick: () => void; children: React.ReactNode
}) {
  return (
    <button onClick={onClick} className="py-1.5 rounded-lg text-[10px] font-medium border"
      style={{
        background:  active ? accent : "transparent",
        color:       active ? "#fff" : "#a1a1aa",
        borderColor: active ? accent : "#f1f0ef",
        transition:  `background 160ms ${EZ}, color 160ms ${EZ}, border-color 160ms ${EZ}, transform 120ms ${SP}`,
      }}
      onMouseDown={e => (e.currentTarget.style.transform = "scale(0.95)")}
      onMouseUp={e => (e.currentTarget.style.transform = "scale(1)")}>
      {children}
    </button>
  )
}