import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

export async function GET() {
  const supabase = createRouteHandlerClient({ cookies });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data, error } = await supabase
    .from('subscriber_joi_sets')
    .select('*, member_count:subscriber_joi_members(count)')
    .eq('subscriber_id', user.id)
    .eq('is_active', true)
    .order('created_at', { ascending: true });

  if (error) return NextResponse.json({ error }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  const supabase = createRouteHandlerClient({ cookies });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { count } = await supabase
    .from('subscriber_joi_sets')
    .select('*', { count: 'exact', head: true })
    .eq('subscriber_id', user.id)
    .eq('is_active', true);

  if ((count ?? 0) >= 10)
    return NextResponse.json(
      { error: 'Maximum 10 Jurisdiction of Interest sets allowed' }, { status: 400 }
    );

  const { name, description, color } = await req.json();
  const { data, error } = await supabase
    .from('subscriber_joi_sets')
    .insert({ subscriber_id: user.id, name, description, color })
    .select()
    .single();

  if (error) return NextResponse.json({ error }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
