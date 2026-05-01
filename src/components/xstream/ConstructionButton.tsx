import { useState, useEffect, useCallback, useRef } from "react";
import {
  Hash,
  Plus,
  User,
  Palette,
  X,
  GripVertical,
  Zap,
  ArrowRight,
  Loader2,
  ChevronDown,
  MapPin,
  UserPlus,
  Handshake,
  IdCard,
  KeyRound,
} from "lucide-react";
import { Theme } from "@/types/xstream";

export type ActionVerb = 'mark' | 'register' | 'engage' | 'passport' | 'keys';

export interface ActionDef {
  verb: ActionVerb;
  label: string;
  hint: string;
  template: string;
  needsHandle: boolean;
  needsSecret: boolean;
}

export const ACTIONS: ActionDef[] = [
  { verb: 'mark',     label: 'Drop a mark',    hint: 'leave a trace at this address',          template: '',                                              needsHandle: false, needsSecret: false },
  { verb: 'passport', label: 'Edit passport',  hint: 'publish your self-description',          template: 'passport: ',                                    needsHandle: true,  needsSecret: true  },
  { verb: 'register', label: 'Register',       hint: 'claim a position in a collective',       template: 'register sed:<collective> <declaration>',       needsHandle: true,  needsSecret: true  },
  { verb: 'engage',   label: 'Reach out',      hint: 'open a bilateral channel with someone',  template: 'engage <agent_id> <description> | <my side>',  needsHandle: true,  needsSecret: true  },
  { verb: 'keys',     label: 'Publish keys',   hint: 'derive ed25519+x25519 from your passphrase and publish public halves to passport:9', template: 'keys', needsHandle: true, needsSecret: true },
];

const ICONS: Record<ActionVerb, typeof MapPin> = {
  mark: MapPin,
  passport: IdCard,
  register: UserPlus,
  engage: Handshake,
  keys: KeyRound,
};

export interface IdentityProps {
  handle: string;
  secret: string;
  apiKey: string;
  onIdentityChange: (v: { handle: string; secret: string; apiKey: string }) => void;
  // Multi-handle: list of saved handles + actions to switch / forget. The
  // active handle is `handle` above. Each saved handle has its own secret +
  // API key in sessionStorage; switching loads them (may be empty if the
  // session hasn't unlocked the handle's secret yet — user re-enters it).
  identities: string[];
  onSwitchHandle: (h: string) => void;
  onForgetHandle: (h: string) => void;
}

interface ConstructionButtonProps {
  // Menu actions
  onThemeChange: (theme: Theme) => void;
  currentTheme: Theme;
  // Active CADO face of the focused column. Drives data-face on the button
  // wrapper so internal `bg-face-accent` and `icon-accent` rules pick up the
  // right color (yellow=Character, blue=Author, pink=Designer, green=Observer).
  face?: "character" | "author" | "designer" | "observer";
  // Multi-column controls live in the settings menu so the surface stays
  // calm. Spawn opens a new column inheriting the active one's seed; close
  // is per-column (✕ in each column header).
  onSpawnColumn?: () => void;
  columnCount?: number;
  // Input actions
  onQuery: (text: string) => void;
  onSubmit: (text: string) => void;
  // Controlled input
  value: string;
  onChange: (value: string) => void;
  // State
  isQuerying?: boolean;
  placeholder?: string;
  // Column awareness (for future multi-column)
  columnId?: string;
  // Identity (replaces logout — beach mode has no game session)
  identity: IdentityProps;
  // Action verb hint (e.g. last action template injected) — purely visual.
  activeVerb?: ActionVerb | null;
}

const STORAGE_KEY = "xstream-construction-btn-pos";

export function ConstructionButton({
  onThemeChange,
  currentTheme,
  face = "character",
  onSpawnColumn,
  columnCount = 1,
  onQuery,
  onSubmit,
  value,
  onChange,
  isQuerying = false,
  placeholder = "Type your thought...",
  columnId,
  identity,
  activeVerb = null,
}: ConstructionButtonProps) {
  const [showIdentity, setShowIdentity] = useState(false);
  const [editHandle, setEditHandle] = useState(identity.handle);
  const [editSecret, setEditSecret] = useState(identity.secret);
  const [editApiKey, setEditApiKey] = useState(identity.apiKey);
  useEffect(() => {
    setEditHandle(identity.handle);
    setEditSecret(identity.secret);
    setEditApiKey(identity.apiKey);
  }, [identity.handle, identity.secret, identity.apiKey]);
  const saveIdentity = () => {
    identity.onIdentityChange({ handle: editHandle.trim(), secret: editSecret.trim(), apiKey: editApiKey.trim() });
    setShowIdentity(false);
  };
  const forgetIdentity = () => {
    identity.onIdentityChange({ handle: "", secret: "", apiKey: "" });
    setEditHandle(""); setEditSecret(""); setEditApiKey("");
    setShowIdentity(false);
  };
  const [isOpen, setIsOpen] = useState(false);       // Settings menu open
  const [isExpanded, setIsExpanded] = useState(false); // Input panel open
  const [position, setPosition] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        // Fall through to default
      }
    }
    // Default: bottom center, above the vapor zone area
    return {
      x: Math.max(20, (window.innerWidth - 56) / 2),
      y: window.innerHeight - 180
    };
  });
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const buttonRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(position));
  }, [position]);

  // Focus textarea when expanded
  useEffect(() => {
    if (isExpanded && !isOpen) {
      setTimeout(() => textareaRef.current?.focus(), 50);
    }
  }, [isExpanded, isOpen]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    const t = e.target as HTMLElement;
    // Don't start a drag when the user is interacting with form/text controls
    // or any element inside the settings popover.
    if (t.closest("button") || t.closest("textarea") || t.closest("input") ||
        t.closest("label") || t.closest("[data-no-drag]")) return;
    e.preventDefault();
    setIsDragging(true);
    dragStart.current = { x: e.clientX - position.x, y: e.clientY - position.y };
  }, [position]);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const newX = Math.max(0, Math.min(window.innerWidth - 56, e.clientX - dragStart.current.x));
      const newY = Math.max(0, Math.min(window.innerHeight - 56, e.clientY - dragStart.current.y));
      setPosition({ x: newX, y: newY });
    };

    const handleMouseUp = () => setIsDragging(false);

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging]);

  const handleQuery = () => {
    if (value.trim() && !isQuerying) {
      onQuery(value.trim());
    }
  };

  const handleSubmit = () => {
    if (value.trim()) {
      onSubmit(value.trim());
      onChange("");
      setIsExpanded(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      if (e.metaKey || e.ctrlKey) {
        // Cmd/Ctrl+Enter → Query Soft-LLM
        e.preventDefault();
        handleQuery();
      } else if (e.shiftKey) {
        // Shift+Enter → Submit to Liquid
        e.preventDefault();
        handleSubmit();
      }
      // Plain Enter → newline (default textarea behavior)
    } else if (e.key === "Escape") {
      setIsExpanded(false);
      setIsOpen(false);
    }
  };

  const handleClear = () => {
    onChange("");
    textareaRef.current?.focus();
  };

  const handleMainButtonClick = () => {
    if (isDragging) return;

    if (isOpen) {
      // Menu is open → close everything
      setIsOpen(false);
      setIsExpanded(false);
    } else if (isExpanded) {
      // Input is open → open menu
      setIsOpen(true);
    } else {
      // Everything closed → open input
      setIsExpanded(true);
    }
  };

  // Close menu when clicking outside
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (buttonRef.current && !buttonRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  const themes: { value: Theme; label: string }[] = [
    { value: "dark", label: "Dark" },
    { value: "light", label: "Light" },
    { value: "cyber", label: "Cyber" },
    { value: "soft", label: "Soft" },
  ];

  // Icon logic: # (closed) → + (input open) → X (menu open)
  const getIcon = () => {
    if (isOpen) return <X className="h-5 w-5" />;
    if (isExpanded) return <Plus className="h-5 w-5" />;
    return <Hash className="h-5 w-5" />;
  };

  return (
    <div
      ref={buttonRef}
      className="fixed z-50"
      style={{ left: position.x, top: position.y }}
      onMouseDown={handleMouseDown}
      data-column-id={columnId}
      data-face={face}
    >
      {/* Settings Menu */}
      {isOpen && (
        <div data-no-drag className="absolute bottom-14 right-0 w-64 glass rounded-lg overflow-hidden shadow-lg animate-slide-up text-foreground">
          <div className="px-4 py-3 border-b border-border/50">
            <span className="text-sm font-medium text-foreground">Settings</span>
          </div>

          <div className="py-1">
            {onSpawnColumn && (
              <button
                onClick={() => { onSpawnColumn(); }}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-foreground hover:bg-accent/50 transition-colors"
                title="Open a new column inheriting the focused column's beach + face"
              >
                <span className="h-4 w-4 flex items-center justify-center text-muted-foreground text-base leading-none">+</span>
                <span className="flex-1 text-left">New column</span>
                <span className="text-[10px] text-muted-foreground font-mono">{columnCount} open</span>
              </button>
            )}

            <div className="px-2 py-1">
              <div className="flex items-center gap-3 px-2 py-1.5 text-sm text-foreground">
                <Palette className="h-4 w-4 text-muted-foreground" />
                <span>Theme</span>
              </div>
              <div className="flex gap-1 px-2 py-1">
                {themes.map((theme) => (
                  <button
                    key={theme.value}
                    onClick={() => onThemeChange(theme.value)}
                    className={`flex-1 px-2 py-1.5 text-xs rounded transition-colors ${
                      currentTheme === theme.value
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted/50 text-foreground hover:bg-accent/50"
                    }`}
                  >
                    {theme.label}
                  </button>
                ))}
              </div>
            </div>

            <button
              onClick={() => setShowIdentity(s => !s)}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-foreground hover:bg-accent/50 transition-colors"
            >
              <User className="h-4 w-4 text-muted-foreground" />
              <span className="flex-1 text-left">Identity</span>
              <span className="text-[10px] text-muted-foreground font-mono">
                {identity.handle ? identity.handle : "anon"}
                {identity.apiKey ? " · llm" : ""}
              </span>
              <ChevronDown className={`h-3 w-3 text-muted-foreground transition-transform ${showIdentity ? "rotate-180" : ""}`} />
            </button>

            {showIdentity && (
              <div className="px-4 pb-3 space-y-2 border-t border-border/40 pt-2">
                {identity.identities.length > 0 && (
                  <div className="space-y-1">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Saved handles</div>
                    <ul className="space-y-1">
                      {identity.identities.map(h => {
                        const active = h === identity.handle
                        const hasSecret = typeof window !== 'undefined' && !!sessionStorage.getItem(`xstream:secret:${h}`)
                        return (
                          <li key={h} className="flex items-center gap-1">
                            <button
                              onClick={() => identity.onSwitchHandle(h)}
                              disabled={active}
                              className={`flex-1 text-left text-[11px] font-mono px-2 py-1 rounded border ${
                                active
                                  ? 'border-primary/60 bg-primary/10 text-foreground cursor-default'
                                  : 'border-border/40 text-muted-foreground hover:text-foreground hover:bg-accent/30'
                              }`}
                              title={active ? 'active handle' : `switch to ${h}${hasSecret ? '' : ' (passphrase needs re-entry)'}`}
                            >
                              {h}
                              {active && <span className="ml-2 text-[9px] uppercase">active</span>}
                              {!active && !hasSecret && <span className="ml-2 text-[9px] text-muted-foreground/70">🔒 enter pass</span>}
                            </button>
                            <button
                              onClick={() => { if (confirm(`Forget handle "${h}"? This wipes its session secrets and per-face memory in this browser.`)) identity.onForgetHandle(h) }}
                              className="text-muted-foreground/60 hover:text-destructive p-1"
                              title="forget this handle"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                )}
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground pt-1">{identity.handle ? 'Edit current' : 'Add identity'}</div>
                <IdentityField
                  label="handle"
                  hint="public agent_id"
                  value={editHandle}
                  onChange={setEditHandle}
                  placeholder="e.g. happyseaurchin"
                />
                <IdentityField
                  label="passphrase"
                  hint="write-lock (sessionStorage)"
                  value={editSecret}
                  onChange={setEditSecret}
                  placeholder="…"
                  type="password"
                />
                <IdentityField
                  label="API key"
                  hint="Tier 2 — soft & medium"
                  value={editApiKey}
                  onChange={setEditApiKey}
                  placeholder="sk-ant-…"
                  type="password"
                />
                <div className="flex gap-2 justify-between pt-1">
                  <button
                    onClick={forgetIdentity}
                    className="text-[11px] text-muted-foreground hover:text-destructive"
                    title="clear active identity (passphrase + key cleared from session)"
                  >
                    sign out
                  </button>
                  <button
                    onClick={saveIdentity}
                    className="text-[11px] px-2 py-1 rounded bg-primary text-primary-foreground"
                  >
                    save
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="px-4 py-2 border-t border-border/50 bg-muted/30">
            <span className="text-[10px] text-muted-foreground font-mono">
              v0.2
            </span>
          </div>
        </div>
      )}

      {/* Expanded Input Panel */}
      {isExpanded && !isOpen && (
        <div className="absolute bottom-14 right-0 w-[22rem] glass rounded-lg overflow-hidden shadow-lg animate-slide-up">
          <div className="p-3">
            {/* Input row + vertical action column */}
            <div className="flex items-stretch gap-2">
              {/* Left: query + textarea (stacked) */}
              <div className="flex-1 flex items-start gap-2 bg-background/50 rounded-lg p-2">
                {/* Query button (Cmd+Enter) */}
                <button
                  onClick={handleQuery}
                  disabled={isQuerying || !value.trim()}
                  className={`shrink-0 h-8 w-8 rounded-md flex items-center justify-center transition-colors mt-0.5 ${
                    isQuerying
                      ? 'bg-accent-subtle text-accent animate-pulse cursor-wait'
                      : 'bg-accent-subtle icon-accent hover:opacity-80 disabled:opacity-30 disabled:cursor-not-allowed'
                  }`}
                  title="Query Soft-LLM (⌘↵)"
                >
                  {isQuerying ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Zap className="h-4 w-4" />
                  )}
                </button>

                {/* Textarea field */}
                <div className="relative flex-1">
                  <textarea
                    ref={textareaRef}
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={placeholder}
                    rows={3}
                    className="w-full bg-transparent border-none outline-none text-sm text-foreground placeholder:text-muted-foreground/50 resize-none pr-6"
                  />
                  {value && (
                    <button
                      onClick={handleClear}
                      className="absolute right-0 top-1 text-muted-foreground/50 hover:text-muted-foreground transition-colors"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>

              {/* Right: vertical action column. Each icon injects a template
                  prefix into the textarea; the parent's submit dispatcher
                  parses the prefix and fires the matching primitive. */}
              <div className="flex flex-col gap-1 shrink-0" data-no-drag>
                {ACTIONS.map(a => {
                  const Icon = ICONS[a.verb];
                  const handleAvail = !a.needsHandle || !!identity.handle;
                  const secretAvail = !a.needsSecret || !!identity.secret;
                  const enabled = handleAvail && secretAvail;
                  const reason = !handleAvail ? ' — needs handle (Identity)' : !secretAvail ? ' — needs passphrase (Identity)' : '';
                  const active = activeVerb === a.verb;
                  return (
                    <button
                      key={a.verb}
                      onClick={() => {
                        if (!enabled) {
                          setIsOpen(true); // open settings so user can add identity
                          return;
                        }
                        // Inject template (prefix). Empty template = "mark"
                        // mode where input is the mark text directly.
                        onChange(a.template);
                        // For non-empty templates, place caret at end so
                        // typing fills the placeholder section.
                        setTimeout(() => {
                          textareaRef.current?.focus();
                          if (a.template) {
                            const ta = textareaRef.current;
                            if (ta) ta.selectionStart = ta.selectionEnd = a.template.length;
                          }
                        }, 0);
                      }}
                      disabled={false}
                      className={`h-8 w-8 rounded-md flex items-center justify-center transition-all ${
                        active
                          ? 'bg-face-accent text-white'
                          : enabled
                            ? 'bg-background/50 text-muted-foreground hover:text-foreground hover:bg-accent/30'
                            : 'bg-background/30 text-muted-foreground/30 hover:text-muted-foreground/60'
                      }`}
                      title={`${a.label} — ${a.hint}${reason}`}
                    >
                      <Icon className="h-4 w-4" />
                    </button>
                  );
                })}

                {/* Submit (Shift+Enter) — sits at the bottom of the column,
                    visually anchoring the action stack as the commit step. */}
                <button
                  onClick={handleSubmit}
                  disabled={!value.trim()}
                  className="h-8 w-8 rounded-md flex items-center justify-center bg-face-accent text-white disabled:opacity-30 disabled:cursor-not-allowed hover:opacity-90 transition-opacity mt-1"
                  title="Submit (⇧↵)"
                >
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Hints row */}
            <div className="flex items-center gap-2 mt-2 px-1">
              <div className="flex-1" />
              <div className="flex gap-2 text-[10px] text-muted-foreground/40">
                <span>⌘↵ ask</span>
                <span>⇧↵ submit</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Drag handle + Main button */}
      <div className={`flex items-center gap-1 ${isDragging ? "cursor-grabbing" : "cursor-grab"}`}>
        <div className="p-1 text-muted-foreground opacity-50 hover:opacity-100 transition-opacity">
          <GripVertical className="h-4 w-4" />
        </div>
        <button
          onClick={handleMainButtonClick}
          className="floating-button transition-transform duration-200"
          style={{ position: "relative" }}
        >
          {getIcon()}
        </button>
      </div>
    </div>
  );
}

function IdentityField({
  label,
  hint,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: "text" | "password";
}) {
  return (
    <label className="block">
      <div className="flex items-baseline gap-2 mb-0.5">
        <span className="text-[11px] font-medium text-foreground">{label}</span>
        {hint && <span className="text-[10px] text-muted-foreground">{hint}</span>}
      </div>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-2 py-1 text-xs rounded border border-border/50 bg-background text-foreground outline-none focus:border-primary/60"
      />
    </label>
  );
}
