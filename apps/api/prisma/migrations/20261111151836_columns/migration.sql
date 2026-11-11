-- CreateEnum
CREATE TYPE "ColumnCategory" AS ENUM ('BACKLOG', 'TODO', 'IN_PROGRESS', 'DONE');

-- CreateTable
CREATE TABLE "Column" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    -- Hand-written: byte-order collation, so ORDER BY "rank" matches JavaScript string comparison.
    "rank" TEXT COLLATE "C" NOT NULL,
    "category" "ColumnCategory" NOT NULL DEFAULT 'TODO',
    "wipLimit" INTEGER,
    "wipStrict" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Column_pkey" PRIMARY KEY ("id")
);

-- CreateIndex (hand-written: a deferrable constraint instead of a plain unique index)
-- Checked at the end of each statement rather than after every row, so a rebalance can rewrite
-- all ranks of a board in a single UPDATE. Also serves as the index for listing by rank.
ALTER TABLE "Column" ADD CONSTRAINT "Column_boardId_rank_key" UNIQUE ("boardId", "rank") DEFERRABLE INITIALLY IMMEDIATE;

-- AddForeignKey
ALTER TABLE "Column" ADD CONSTRAINT "Column_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board"("id") ON DELETE CASCADE ON UPDATE CASCADE;
