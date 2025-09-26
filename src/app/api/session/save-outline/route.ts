import { z } from 'zod';

export const runtime = 'nodejs';

type SavedOutline = {
  sessionId: string;
  outlineXml: string;
  savedAt: number;
};

const store = new Map<string, SavedOutline>();

const BodySchema = z.object({
  sessionId: z.string().min(1, 'sessionId required'),
  outlineXml: z.string().min(1, 'outlineXml required'),
});

export async function POST(req: Request): Promise<Response> {
  try {
    const json = await req.json();
    const parsed = BodySchema.safeParse(json);
    if (!parsed.success) {
      return Response.json(
        { error: 'Invalid body', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { sessionId, outlineXml } = parsed.data;

    const saved: SavedOutline = {
      sessionId,
      outlineXml,
      savedAt: Date.now(),
    };

    store.set(sessionId, saved);

    return Response.json({
      ok: true,
      sessionId,
      length: outlineXml.length,
      savedAt: saved.savedAt,
    });
  } catch (err: any) {
    console.error('SAVE OUTLINE API error:', err);
    return Response.json(
      { error: 'Internal Server Error', message: err?.message ?? 'Unknown error' },
      { status: 500 }
    );
  }
}

export async function GET(req: Request): Promise<Response> {
  try {
    const url = new URL(req.url);
    const sessionId = url.searchParams.get('sessionId') ?? '';
    if (!sessionId) {
      return Response.json({ error: 'sessionId required' }, { status: 400 });
    }

    const outline = store.get(sessionId);
    if (!outline) {
      return Response.json({ error: 'outline not found', sessionId }, { status: 404 });
    }

    return Response.json({
      ok: true,
      sessionId,
      outlineXml: outline.outlineXml,
      savedAt: outline.savedAt,
    });
  } catch (err: any) {
    console.error('GET OUTLINE API error:', err);
    return Response.json(
      { error: 'Internal Server Error', message: err?.message ?? 'Unknown error' },
      { status: 500 }
    );
  }
}