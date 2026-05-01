import { SolidBlock, Face } from "@/types/xstream";

interface SolidZoneProps {
  blocks: SolidBlock[];
  height: number;
}

// CADO single-letter glyph for the face badge — keeps the surface terse.
const FACE_GLYPH: Record<Face, string> = {
  character: 'C',
  author: 'A',
  designer: 'D',
  observer: 'O',
};

export function SolidZone({ blocks, height }: SolidZoneProps) {
  return (
    <div
      className="zone-solid overflow-y-auto px-3 py-4"
      style={{ height: `${height}px`, minHeight: "80px" }}
    >
      {blocks.length === 0 ? (
        <div className="flex h-full items-center justify-center">
          <p className="text-sm text-muted-foreground/60 italic">
            No committed content yet
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {blocks.map((block) => (
            <article
              key={block.id}
              className="card-solid rounded-lg p-4 animate-fade-in"
            >
              {(block.title || block.face) && (
                <h3 className="mb-2 text-sm font-medium text-foreground/90 flex items-center gap-2">
                  {block.title && <span>{block.title}</span>}
                  {block.face && (
                    <span
                      className="text-[10px] px-1.5 py-0.5 rounded border border-border/40 text-muted-foreground font-mono"
                      title={`made from ${block.face} face`}
                    >
                      {FACE_GLYPH[block.face]}
                    </span>
                  )}
                </h3>
              )}
              <div className="text-sm leading-relaxed text-foreground/80 whitespace-pre-wrap">
                {block.content}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
