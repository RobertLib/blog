import { Navbar } from "@/components/ui";

export default function AdminLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <>
      <Navbar />

      <main>{children}</main>
    </>
  );
}
