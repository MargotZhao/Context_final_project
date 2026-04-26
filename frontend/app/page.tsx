import Chat from "@/components/Chat";

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center py-8 px-4">
      <div className="w-full max-w-3xl mb-6">
        <h1 className="text-2xl font-bold text-gray-100">Claude Agent</h1>
        <p className="text-gray-400 text-sm mt-1">
          Powered by{" "}
          <code className="text-indigo-400">claude-opus-4-7</code>
          {" · "}Web search · Calculator · Supabase logging
        </p>
      </div>
      <Chat />
    </main>
  );
}
