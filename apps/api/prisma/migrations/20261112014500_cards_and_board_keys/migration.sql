-- CreateEnum
CREATE TYPE "CardPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- AlterTable (hand-written: "key" and "ownerId" are added nullable, backfilled, then made NOT NULL)
ALTER TABLE "Board" ADD COLUMN     "key" TEXT,
ADD COLUMN     "nextCardNumber" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "ownerId" TEXT;

-- backfill:begin
-- Hand-written backfill of existing boards (a single statement, also run by the migration test):
-- - "ownerId" from the OWNER membership (boards are always created with one; see below for
--   boards written outside the API),
-- - "key" from the name: initials of the words, or the first two letters of a single word, at
--   most 5 letters, 'BRD' without usable letters; diacritics and Cyrillic are transliterated
--   (an approximation of the application's generator, which is used for new boards). Duplicates
--   of one owner get letter suffixes ("SB" -> "SBA", "SBB", ...; "ABCDE" -> "ABCDA", ...).
DO $backfill$
DECLARE
    board RECORD;
    txt TEXT;
    word TEXT;
    words TEXT[];
    base TEXT;
    candidate TEXT;
    suffix TEXT;
    attempt INTEGER;
    rest INTEGER;
    affected INTEGER;
BEGIN
    -- Boards without any member are not reachable through the API (everyone gets 404).
    DELETE FROM "Board" AS b
    WHERE NOT EXISTS (SELECT 1 FROM "BoardMember" AS m WHERE m."boardId" = b."id");
    GET DIAGNOSTICS affected = ROW_COUNT;
    RAISE NOTICE 'Board key backfill: deleted % board(s) without members', affected;

    -- The API always creates a board with its OWNER; should one be missing (rows written outside
    -- the API), the most privileged, longest-standing member becomes the OWNER.
    UPDATE "BoardMember" SET "role" = 'OWNER'
    WHERE "id" IN (
        SELECT DISTINCT ON (m."boardId") m."id"
        FROM "BoardMember" AS m
        WHERE NOT EXISTS (
            SELECT 1 FROM "BoardMember" AS o WHERE o."boardId" = m."boardId" AND o."role" = 'OWNER'
        )
        ORDER BY m."boardId", m."role", m."createdAt", m."id"
    );
    GET DIAGNOSTICS affected = ROW_COUNT;
    RAISE NOTICE 'Board key backfill: promoted % member(s) to OWNER', affected;

    UPDATE "Board" AS b SET "ownerId" = m."userId"
    FROM "BoardMember" AS m
    WHERE m."boardId" = b."id" AND m."role" = 'OWNER';

    FOR board IN SELECT "id", "name", "ownerId" FROM "Board" ORDER BY "createdAt", "id" LOOP
        txt := board."name";
        txt := replace(txt, 'ß', 'ss');
        txt := replace(txt, 'æ', 'ae');
        txt := replace(txt, 'Æ', 'AE');
        txt := replace(txt, 'œ', 'oe');
        txt := replace(txt, 'Œ', 'OE');
        txt := replace(txt, 'þ', 'th');
        txt := replace(txt, 'Þ', 'TH');
        txt := replace(txt, 'є', 'ye');
        txt := replace(txt, 'Є', 'YE');
        txt := replace(txt, 'ё', 'yo');
        txt := replace(txt, 'Ё', 'YO');
        txt := replace(txt, 'ж', 'zh');
        txt := replace(txt, 'Ж', 'ZH');
        txt := replace(txt, 'ї', 'yi');
        txt := replace(txt, 'Ї', 'YI');
        txt := replace(txt, 'х', 'kh');
        txt := replace(txt, 'Х', 'KH');
        txt := replace(txt, 'ц', 'ts');
        txt := replace(txt, 'Ц', 'TS');
        txt := replace(txt, 'ч', 'ch');
        txt := replace(txt, 'Ч', 'CH');
        txt := replace(txt, 'ш', 'sh');
        txt := replace(txt, 'Ш', 'SH');
        txt := replace(txt, 'щ', 'shch');
        txt := replace(txt, 'Щ', 'SHCH');
        txt := replace(txt, 'ю', 'yu');
        txt := replace(txt, 'Ю', 'YU');
        txt := replace(txt, 'я', 'ya');
        txt := replace(txt, 'Я', 'YA');
        txt := replace(txt, 'ъ', '');
        txt := replace(txt, 'Ъ', '');
        txt := replace(txt, 'ь', '');
        txt := replace(txt, 'Ь', '');
        txt := translate(txt,
            'àÀáÁâÂãÃäÄåÅāĀăĂąĄçÇćĆĉĈċĊčČďĎđĐðÐèÈéÉêÊëËēĒĕĔėĖęĘěĚĝĜğĞġĠģĢĥĤħĦìÌíÍîÎïÏĩĨīĪĭĬįĮıIĵĴķĶĺĹļĻľĽŀĿłŁñÑńŃņŅňŇòÒóÓôÔõÕöÖøØōŌŏŎőŐŕŔŗŖřŘśŚŝŜşŞšŠţŢťŤŧŦùÙúÚûÛüÜũŨūŪŭŬůŮűŰųŲŵŴýÝÿŸŷŶźŹżŻžŽаАбБвВгГґҐдДеЕзЗиИіІйЙкКлЛмМнНоОпПрРсСтТуУфФыЫэЭ',
            'aAaAaAaAaAaAaAaAaAcCcCcCcCcCdDdDdDeEeEeEeEeEeEeEeEeEgGgGgGgGhHhHiIiIiIiIiIiIiIiIiIjJkKlLlLlLlLlLnNnNnNnNoOoOoOoOoOoOoOoOoOrRrRrRsSsSsSsStTtTtTuUuUuUuUuUuUuUuUuUuUwWyYyYyYzZzZzZaAbBvVhHgGdDeEzZyYiIyYkKlLmMnNoOpPrRsStTuUfFyYeE');
        txt := upper(txt);

        words := ARRAY[]::TEXT[];
        FOREACH word IN ARRAY regexp_split_to_array(txt, '[^A-Z]+') LOOP
            IF word <> '' THEN
                words := array_append(words, word);
            END IF;
        END LOOP;

        base := '';
        FOREACH word IN ARRAY words LOOP
            base := base || left(word, 1);
        END LOOP;
        IF length(base) < 2 AND cardinality(words) > 0 THEN
            base := left(words[1], 2);
        END IF;
        base := left(base, 5);
        IF length(base) < 2 THEN
            base := 'BRD';
        END IF;

        candidate := base;
        attempt := 0;
        WHILE EXISTS (
            SELECT 1 FROM "Board" WHERE "ownerId" = board."ownerId" AND "key" = candidate
        ) LOOP
            attempt := attempt + 1;
            suffix := '';
            rest := attempt;
            WHILE rest > 0 LOOP
                rest := rest - 1;
                suffix := chr(65 + rest % 26) || suffix;
                rest := rest / 26;
            END LOOP;
            IF length(suffix) > 4 THEN
                RAISE EXCEPTION 'No free board key for board %', board."id";
            END IF;
            candidate := left(base, LEAST(length(base), 5 - length(suffix))) || suffix;
        END LOOP;

        UPDATE "Board" SET "key" = candidate WHERE "id" = board."id";
    END LOOP;
END
$backfill$;
-- backfill:end

ALTER TABLE "Board" ALTER COLUMN "key" SET NOT NULL,
ALTER COLUMN "ownerId" SET NOT NULL;

-- CreateTable
CREATE TABLE "Card" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "columnId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    -- Hand-written: byte-order collation, so ORDER BY "rank" matches JavaScript string comparison.
    "rank" TEXT COLLATE "C" NOT NULL,
    "priority" "CardPriority" NOT NULL DEFAULT 'MEDIUM',
    "assigneeId" TEXT,
    "dueDate" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Card_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CardTransition" (
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "fromColumnId" TEXT,
    "toColumnId" TEXT,
    "movedById" TEXT,
    "movedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CardTransition_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Card_assigneeId_idx" ON "Card"("assigneeId");

-- CreateIndex
CREATE UNIQUE INDEX "Card_boardId_number_key" ON "Card"("boardId", "number");

-- CreateIndex (hand-written: a deferrable constraint instead of a plain unique index)
-- Checked at the end of each statement rather than after every row, so a rebalance can rewrite
-- all ranks of a column in a single UPDATE. Also serves as the index for listing by rank.
ALTER TABLE "Card" ADD CONSTRAINT "Card_columnId_rank_key" UNIQUE ("columnId", "rank") DEFERRABLE INITIALLY IMMEDIATE;

-- CreateIndex
CREATE INDEX "CardTransition_boardId_movedAt_idx" ON "CardTransition"("boardId", "movedAt");

-- CreateIndex
CREATE INDEX "CardTransition_cardId_movedAt_idx" ON "CardTransition"("cardId", "movedAt");

-- CreateIndex
CREATE INDEX "CardTransition_fromColumnId_idx" ON "CardTransition"("fromColumnId");

-- CreateIndex
CREATE INDEX "CardTransition_toColumnId_idx" ON "CardTransition"("toColumnId");

-- CreateIndex
CREATE UNIQUE INDEX "Board_ownerId_key_key" ON "Board"("ownerId", "key");

-- AddForeignKey
ALTER TABLE "Board" ADD CONSTRAINT "Board_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Card" ADD CONSTRAINT "Card_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Card" ADD CONSTRAINT "Card_columnId_fkey" FOREIGN KEY ("columnId") REFERENCES "Column"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Card" ADD CONSTRAINT "Card_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardTransition" ADD CONSTRAINT "CardTransition_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardTransition" ADD CONSTRAINT "CardTransition_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardTransition" ADD CONSTRAINT "CardTransition_fromColumnId_fkey" FOREIGN KEY ("fromColumnId") REFERENCES "Column"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardTransition" ADD CONSTRAINT "CardTransition_toColumnId_fkey" FOREIGN KEY ("toColumnId") REFERENCES "Column"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardTransition" ADD CONSTRAINT "CardTransition_movedById_fkey" FOREIGN KEY ("movedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
