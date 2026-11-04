import { NextResponse } from "next/server";
import { healthPayload } from "@/lib/health";

export const dynamic = "force-dynamic";

// عام عن قصد: فحص الصحة
export function GET() {
  return NextResponse.json(healthPayload());
}
