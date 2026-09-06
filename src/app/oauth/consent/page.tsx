import { getMcpConfig } from "@/lib/mcp/config";
import Consent from "./Consent";

export const dynamic = "force-dynamic";

export default async function ConsentPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  let clientIds: string[];
  try {
    clientIds = getMcpConfig().clientIds;
  } catch {
    return <main className="phone px-5 py-10"><h1 className="text-xl font-bold">外部AIとの連携は準備中です</h1><p className="mt-3">安全性の確認とサーバー設定が完了するまで、連携を許可できません。</p></main>;
  }
  const id = params.authorization_id;
  return <Consent authorizationId={typeof id === "string" && id.length <= 512 ? id : ""} clientIds={clientIds} />;
}
