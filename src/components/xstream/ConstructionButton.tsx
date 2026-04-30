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
  Paperclip,
  Mic,
  ChevronDown,
} from "lucide-react";
import { Theme } from "@/types/xstream";

export interface IdentityProps {
  handle: string;
  secret: string;
  apiKey: string;
  onIdentityChange: (v: { handle: string; secret: string; apiKey: string }) => void;
}

interface ConstructionButtonProps {
  // Menu actions
  onThemeChange: (theme: Theme) => void;
  currentTheme: Theme;
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
}

const STORAGE_KEY = "xstream-construction-btn-pos";

export function ConstructionButton({
  onThemeChange,
  currentTheme,
  onQuery,
  onSubmit,
  value,
  onChange,
  isQuerying = false,
  placeholder = "Type your thought...",
  columnId,
  identity,
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
    if ((e.target as HTMLElement).closest("button") ||
        (e.target as HTMLElement).closest("textarea")) return;
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
    >
      {/* Settings Menu */}
      {isOpen && (
        <div className="absolute bottom-14 right-0 w-56 glass rounded-lg overflow-hidden shadow-lg animate-slide-up text-foreground">
          <div className="px-4 py-3 border-b border-border/50">
            <span className="text-sm font-medium text-foreground">Settings</span>
          </div>

          <div className="py-1">
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
                    title="clear identity in this browser"
                  >
                    forget
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
              v0.12.1
            </span>
          </div>
        </div>
      )}

      {/* Expanded Input Panel */}
      {isExpanded && !isOpen && (
        <div className="absolute bottom-14 right-0 w-80 glass rounded-lg overflow-hidden shadow-lg animate-slide-up">
          <div className="p-3">
            {/* Input row */}
            <div className="flex items-start gap-2 bg-background/50 rounded-lg p-2">
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
                  rows={2}
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

              {/* Submit button (Shift+Enter) */}
              <button
                onClick={handleSubmit}
                disabled={!value.trim()}
                className="shrink-0 h-8 w-8 rounded-md flex items-center justify-center bg-face-accent text-white disabled:opacity-30 disabled:cursor-not-allowed hover:opacity-90 transition-opacity mt-0.5"
                title="Submit to Liquid (⇧↵)"
              >
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>

            {/* Action buttons row */}
            <div className="flex items-center gap-2 mt-2 px-1">
              {/* Attachment stub */}
              <button
                className="h-7 w-7 rounded flex items-center justify-center text-muted-foreground/50 hover:text-muted-foreground hover:bg-accent/20 transition-colors"
                title="Attach file (coming soon)"
                disabled
              >
                <Paperclip className="h-4 w-4" />
              </button>

              {/* Audio stub */}
              <button
                className="h-7 w-7 rounded flex items-center justify-center text-muted-foreground/50 hover:text-muted-foreground hover:bg-accent/20 transition-colors"
                title="Voice input (coming soon)"
                disabled
              >
                <Mic className="h-4 w-4" />
              </button>

              <div className="flex-1" />

              {/* Keyboard hints */}
              <div className="flex gap-2 text-[10px] text-muted-foreground/40">
                <span>⌘↵ query</span>
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
