import { getDictionary } from "@/dictionaries";
import { NextAuthOptions } from "next-auth";
import { User } from "@prisma/client";
import bcrypt from "bcrypt";
import CredentialsProvider from "next-auth/providers/credentials";
import prisma from "@/db";

const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      // The name to display on the sign in form (e.g. "Sign in with...")
      name: "Credentials",
      // `credentials` is used to generate a form on the sign in page.
      // You can specify which fields should be submitted, by adding keys to the `credentials` object.
      // e.g. domain, username, password, 2FA token, etc.
      // You can pass any HTML attribute to the <input> tag through the object.
      credentials: {
        email: { label: "Email", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials, req) {
        const dict = await getDictionary();

        const user = await prisma.user.findUnique({
          where: {
            email: credentials?.email,
          },
        });

        if (
          !user?.password ||
          !credentials?.password ||
          !(await bcrypt.compare(credentials.password, user.password))
        ) {
          throw new Error(dict.errors.invalidCredentials);
        }

        return {
          id: user.id.toString(),
          email: user.email,
          name: user.name,
          role: user.role,
        };
      },
    }),
  ],
  callbacks: {
    async session({ session, token, trigger, newSession }) {
      const user = token.user as User;

      session.user = { ...session.user, ...user };

      if (trigger === "update" && newSession) {
        await prisma.user.update({
          data: newSession,
          where: { id: session.user.id },
        });

        session.user = { ...session.user, ...newSession };
      }

      return session;
    },
    async jwt({ session, token, trigger, user }) {
      if (user) {
        token = { ...token, user };
      }

      if (trigger === "update" && token.user && session) {
        await prisma.user.update({
          data: session,
          where: { id: (token.user as User).id },
        });

        token.user = { ...token.user, ...session };
      }

      return token;
    },
  },
  pages: {
    signIn: "/login",
  },
};

export default authOptions;
