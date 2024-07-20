"use server";

import { getDictionary } from "@/dictionaries";
import { Prisma } from "@prisma/client";
import { redirect } from "next/navigation";
import { z } from "zod";
import bcrypt from "bcrypt";
import prisma from "@/db";

const schema = (dict: Awaited<ReturnType<typeof getDictionary>>) =>
  z
    .object({
      email: z.string().email(),
      password: z.string().min(8),
      confirmPassword: z.string().min(8),
    })
    .refine((data) => data.password === data.confirmPassword, {
      message: dict.errors.passwordsDontMatch,
      path: ["confirmPassword"],
    });

export async function createUser(prevState: any, formData: FormData) {
  const dict = await getDictionary();

  const validatedFields = schema(dict).safeParse(Object.fromEntries(formData));

  if (!validatedFields.success) {
    return {
      errors: validatedFields.error.flatten().fieldErrors,
    };
  }

  const { email, password } = validatedFields.data;

  try {
    const hash = await bcrypt.hash(password, 12);

    await prisma.user.create({
      data: { email, password: hash },
    });
  } catch (error) {
    console.error(error);

    if ((error as Prisma.PrismaClientKnownRequestError).code === "P2002") {
      return { errorMessage: dict.errors.emailAlreadyExists };
    }

    return { errorMessage: dict.errors.somethingWentWrong };
  }

  return redirect("/login");
}
