import "dotenv/config";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../src/generated/prisma/client.js";
import bcrypt from "bcryptjs";

const url = process.env["DATABASE_URL"] ?? "file:./prisma/dev.db";
const adapter = new PrismaBetterSqlite3({ url });
const prisma = new PrismaClient({ adapter });

async function main() {
  // Seed users
  const mara = await prisma.user.upsert({
    where: { username: "mara" },
    update: {},
    create: { username: "mara", passwordHash: await bcrypt.hash("password", 10) },
  });
  const devin = await prisma.user.upsert({
    where: { username: "devin" },
    update: {},
    create: { username: "devin", passwordHash: await bcrypt.hash("password", 10) },
  });

  // Seed book
  const book = await prisma.book.upsert({
    where: { id: "book-embergale" },
    update: {},
    create: {
      id: "book-embergale",
      title: "The Embergale Letters",
      premise:
        "In a city where memories can be sealed in glass, a young archivist finds a letter addressed to her that hasn't been written yet.",
      genre: "Literary fantasy",
      visibility: "public",
      hostId: mara.id,
    },
  });

  // Seed chapters
  const existingChapters = await prisma.chapter.count({ where: { bookId: book.id } });
  if (existingChapters === 0) {
    await prisma.chapter.createMany({
      data: [
        {
          bookId: book.id,
          authorId: mara.id,
          index: 1,
          title: "The Unwritten Letter",
          state: "approved",
          approvedAt: new Date(),
          body: "The archive smelled of cold glass and older dust. Liesl had catalogued seven thousand sealed memories before she found the one with her own name on it — a letter dated three winters from now, in handwriting she did not yet recognize as her own.\n\nShe did not open it. One did not open a memory before its time; that was the first rule of the Embergale. But she carried its weight in her apron pocket all the way home, and it was warm, which no sealed glass had any right to be.",
        },
        {
          bookId: book.id,
          authorId: devin.id,
          index: 2,
          title: "What the Glass Keeps",
          state: "approved",
          approvedAt: new Date(),
          body: "Old Tomas had warned her about warm glass. \"Means the memory's still happening,\" he'd said, tapping his pipe against the cataloguing bench. \"Means somewhere, someone's living it right now — or will be.\"\n\nLiesl spent the evening pretending to read while the letter sat on her windowsill, glowing faintly against the rain. By midnight she had decided two things: she would not open it, and she would find out who had sealed it. The two decisions, she would later realize, were the same decision.",
        },
      ],
    });
  }

  // Seed bible
  const existingBible = await prisma.bibleEntry.count({ where: { bookId: book.id } });
  if (existingBible === 0) {
    await prisma.bibleEntry.createMany({
      data: [
        { bookId: book.id, type: "character", name: "Liesl", detail: "Young archivist at the Embergale. Catalogues sealed memories. Found a letter addressed to her, dated three winters in the future.", spoilerScope: 1 },
        { bookId: book.id, type: "character", name: "Tomas", detail: "Old cataloguer, mentor figure. Warns that warm glass means a memory is still happening.", spoilerScope: 2 },
        { bookId: book.id, type: "fact", name: "Sealing rule", detail: "One does not open a sealed memory before its time. Warm glass means the memory is still in progress.", spoilerScope: 1 },
        { bookId: book.id, type: "thread", name: "Who sealed the letter?", detail: "Open mystery: Liesl wants to find who sealed a letter to her from the future.", spoilerScope: 2 },
        { bookId: book.id, type: "sealed", name: "ENDING — author of the letter", detail: "Planned reveal (host-sealed): the letter was sealed by Liesl herself, after the events of the book. Must NOT be revealed by the AI or any chapter until unsealed.", spoilerScope: 9999 },
      ],
    });
  }

  console.log("Seed complete.");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
