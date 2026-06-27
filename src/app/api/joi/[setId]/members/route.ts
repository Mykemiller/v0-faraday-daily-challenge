import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest, { params }: { params: { setId: string } }) {
  const supabase = createRouteHandlerClient({ cookies });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { jurisdictionId } = await req.json();

  const { count } = await supabase
    .from('subscriber_joi_members')
    .select('*', { count: 'exact', head: true })
    .eq('set_id', params.setId);

  if ((count ?? 0) >= 1000)
    return NextResponse.json(
      { error: 'Maximum 1,000 jurisdictions per set' }, { status: 400 }
    );

  const { data, error } = await supabase
    .from('subscriber_joi_members')
    .insert({ set_id: params.setId, jurisdiction_id: jurisdictionId })
    .select()
    .single();

  if (error) return NextResponse.json({ error }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}

export async function DELETE(req: NextRequest, { params }: { params: { setId: string } }) {
  const supabase = createRouteHandlerClient({ cookies });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { jurisdictionId } = await req.json();
  await supabase
    .from('subscriber_joi_members')
    .delete()
    .eq('set_id', params.setId)
    .eq('jurisdiction_id', jurisdictionId);

  return NextResponse.json({ success: true });
}
