import { LiquidCard as LiquidCardType } from "@/types/xstream";

interface LiquidCardProps {
  card: LiquidCardType;
  onCopyToVapor?: () => void;
}

function LiquidCard({ card, onCopyToVapor }: LiquidCardProps) {
  return (
    <div
      className="card-liquid rounded-lg p-3 animate-slide-up cursor-pointer transition-colors hover:bg-accent/5"
      onClick={() => onCopyToVapor?.()}
      title={`${card.userName}'s submission — click to copy to vapor`}
    >
      <div className="mb-2 flex items-center gap-2">
        <span className="h-5 w-5 rounded-full flex items-center justify-center text-[10px] font-medium text-white bg-muted-foreground/50">
          {card.userName.charAt(0).toUpperCase()}
        </span>
        <span className="text-xs text-muted-foreground">
          {card.userName}
        </span>
      </div>
      <p className="text-sm leading-relaxed whitespace-pre-wrap text-foreground/70">
        {card.content}
      </p>
    </div>
  );
}

interface LiquidZoneProps {
  cards: LiquidCardType[];
  height: number;
  // Kept for compatibility with existing callers; the zone no longer
  // distinguishes self from peers — self never appears here. Self-pending
  // is surfaced via the floating button's commit● state.
  currentUserId: string;
  onCopyToVapor?: (text: string) => void;
}

export function LiquidZone({
  cards,
  height,
  onCopyToVapor,
}: LiquidZoneProps) {
  return (
    <div
      className="zone-liquid overflow-y-auto px-3 py-3"
      style={{ height: `${height}px`, minHeight: "100px" }}
    >
      {cards.length === 0 ? (
        <div className="flex h-full items-center justify-center">
          <p className="text-sm text-muted-foreground/50 italic">
            Submitted content appears here
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {cards.map((card) => (
            <LiquidCard
              key={card.id}
              card={card}
              onCopyToVapor={onCopyToVapor ? () => onCopyToVapor(card.content) : undefined}
            />
          ))}
        </div>
      )}
    </div>
  );
}
