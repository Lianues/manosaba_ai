import { z } from 'zod';

export const runtime = 'nodejs';

type SavedStory = {
  sessionId: string;
  title: string;
  content: string;
  savedAt: number;
};

const store = new Map<string, SavedStory>();

const BodySchema = z.object({
  sessionId: z.string().min(1, 'sessionId required'),
  title: z.string().min(1, 'title required'),
  content: z.string().min(1, 'content required'),
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

    const { sessionId, title, content } = parsed.data;
    
    const savedStory: SavedStory = {
      sessionId,
      title,
      content,
      savedAt: Date.now(),
    };
    
    store.set(sessionId, savedStory);

    return Response.json({
      ok: true,
      sessionId,
      title,
      contentLength: content.length,
      savedAt: savedStory.savedAt,
    });
  } catch (err: any) {
    console.error('SAVE STORY API error:', err);
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
    
    const story = store.get(sessionId);
    if (!story) {
      return Response.json({ error: 'story not found', sessionId }, { status: 404 });
    }

    return Response.json({
      ok: true,
      sessionId,
      title: story.title,
      content: story.content,
      savedAt: story.savedAt,
    });
  } catch (err: any) {
    console.error('GET STORY API error:', err);
    return Response.json(
      { error: 'Internal Server Error', message: err?.message ?? 'Unknown error' },
      { status: 500 }
    );
  }
}