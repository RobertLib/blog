"use server";

import { getDictionary } from "@/dictionaries";
import { redirect } from "next/navigation";
import { z } from "zod";
import crypto from "crypto";
import nodemailer from "nodemailer";
import prisma from "@/db";

const schema = z.object({
  email: z.string().email(),
});

export async function forgotPassword(prevState: any, formData: FormData) {
  const dict = await getDictionary();

  const validatedFields = schema.safeParse(Object.fromEntries(formData));

  if (!validatedFields.success) {
    return {
      errors: validatedFields.error.flatten().fieldErrors,
    };
  }

  const { email } = validatedFields.data;

  try {
    const user = await prisma.user.findUnique({ where: { email } });

    if (!user) {
      return { errorMessage: dict.errors.emailNotFound };
    }

    const expires = new Date();
    expires.setDate(expires.getDate() + 1);

    const token = crypto.randomBytes(32).toString("hex");

    await prisma.resetPasswordToken.upsert({
      create: { expires, token, userId: user.id },
      update: { expires, token },
      where: { userId: user.id },
    });

    if (user.email) {
      const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: {
          user: process.env.EMAIL_USER,
          pass: process.env.EMAIL_PASS,
        },
      });

      await transporter.sendMail({
        from: process.env.EMAIL_USER,
        to: user.email,
        subject: dict.emails.resetPassword.subject,
        text: dict.emails.resetPassword.text.replace(
          "{{url}}",
          `${process.env.NEXTAUTH_URL}/reset-password?token=${token}`,
        ),
      });
    }
  } catch (error) {
    console.error(error);

    return { errorMessage: dict.errors.somethingWentWrong };
  }

  return redirect("/forgot-password?resetInstructionsSent=true");
}
