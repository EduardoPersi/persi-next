export default function CustomerWorkspaceLoading() {
  return (
    <main className="mx-auto w-full max-w-6xl animate-pulse px-4 py-8" aria-label="Carregando área da conta">
      <div className="h-8 w-52 rounded bg-slate-200" />
      <div className="mt-8 grid gap-6 lg:grid-cols-[250px_1fr]">
        <div className="hidden h-96 rounded-xl bg-slate-100 lg:block" />
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => <div key={index} className="h-28 rounded-xl bg-slate-100" />)}
        </div>
      </div>
    </main>
  );
}
