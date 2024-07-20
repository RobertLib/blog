import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import authOptions from "../api/auth/[...nextauth]/auth-options";

export default async function AdminTemplate({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await getServerSession(authOptions);

  if (!session?.user.role.includes("ADMIN")) {
    return redirect("/login");
  }

  return <>{children}</>;
}
