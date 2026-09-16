export default function DashboardPage() {
  return (
    <div className="flex h-[60vh] flex-col items-center justify-center text-center">
      <h1 className="text-xl font-semibold">Nenhum item no pipeline ainda</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Assim que a Fase 1 (Ingestão) entrar no ar, os itens recebidos vão aparecer aqui.
      </p>
    </div>
  );
}
