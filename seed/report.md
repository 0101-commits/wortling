# Wortling 씨앗 보고 (2026-10-14)

> **빈 DB 에만 넣는다.** id(w0001…)는 정렬 순서대로 매기는 자리 번호다. 단어가 하나만 늘거나 빠져도 그 뒤 id 가 전부 밀린다.
> 이미 씨앗이 든 DB 에 새 seed.sql 을 넣으면 다른 단어가 같은 id 를 받아, 쌓인 학습 기록(cards)이 엉뚱한 단어에 붙는다.
> 다시 넣을 때는 D1 을 새로 만들고 이주(migrations) → seed.sql 순서로 넣는다.
> 이미 쓰는 DB 에 새 단어를 더할 때는 seed.sql 이 아니라 `npm run words:update`(scripts/words/update.mjs)를 쓴다. (lemma,pos)로 비교해 없는 것만 서버가 id 를 이어 매겨 넣는다.

빌드 명령: `npm run seed:build` → seed/seed.sql (words 8347건, cards 8347건, INSERT 168문) + seed/words.json(정기 업데이트용, keep:false 포함 8678건)
순서: B1 → B2 → C1, 수준 안에서는 빈도 순위 오름차순(없으면 맨 뒤) → 표제어. C1 을 뒤에 붙이므로 B1·B2 의 id 는 C1 과 상관없이 그대로다.
빌드 때 읽은 한국어 내용 파일: B1 6개 · B2 6개 · C1 8개 · 자동 0개 — content_b1_1.json, content_b1_2.json, content_b1_3.json, content_b1_4.json, content_b1_5.json, content_b1_6.json, content_b2_1.json, content_b2_2.json, content_b2_3.json, content_b2_4.json, content_b2_5.json, content_b2_6.json, content_c1_1.json, content_c1_2.json, content_c1_3.json, content_c1_4.json, content_c1_5.json, content_c1_6.json, content_c1_7.json, content_c1_8.json
gloss_ko 채워진 단어: B1 1800건 · B2 2220건 · C1 4327건
내용 파일은 content_<b1|b2|c1>_<번호>.json 과 content_auto_<날짜>.json 이름만 읽는다(쓰는 중인 조각 파일은 무시). 같은 단어는 auto < b1 < b2 < c1 순으로 뒤 파일이 이긴다.

## 수준·품사별 수
| level | 합계 | noun | verb | adj | adv | prep | conj | pron | other | phrase |
|---|---|---|---|---|---|---|---|---|---|---|
| B1 | 1800 | 1027 | 390 | 255 | 79 | 6 | 25 | 14 | 3 | 1 |
| B2 | 2220 | 1133 | 701 | 316 | 70 | 0 | 0 | 0 | 0 | 0 |
| C1 | 4327 | 2459 | 1038 | 746 | 84 | 0 | 0 | 0 | 0 | 0 |

## 채움 비율
| 항목 | B1 | B2 | C1 |
|---|---|---|---|
| 명사 성(gender) | 1026 (100%) | 1130 (100%) | 2448 (100%) |
| 명사 복수(plural) | 958 (93%) | 1058 (93%) | 2257 (92%) |
| 발음(ipa) | 1561 (87%) | 1899 (86%) | 3448 (80%) |
| 영어 뜻(gloss_en) | 1657 (92%) | 2215 (100%) | 4311 (100%) |
| 한국어 뜻(gloss_ko) | 1800 (100%) | 2220 (100%) | 4327 (100%) |
| 예문(example_de) | 1800 (100%) | 2220 (100%) | 4327 (100%) |
| 예문 출처 tatoeba | 0 (0%) | 0 (0%) | 0 (0%) |
| 그림 장면(scene_en) | 1800 (100%) | 2220 (100%) | 4327 (100%) |
| 빈도 순위(freq_rank) | 1551 (86%) | 2220 (100%) | 4327 (100%) |

## DWDS 대조 규칙 (B2·C1 공통)
파일: DWDS 표제어 목록(.data/dwds_lemma.csv, 환경변수 DWDS_LEMMA_CSV 로 바꿈). 순서대로 적용한다.
1. DWDS 에 명사·동사·형용사·부사 항목이 없으면 뺀다(「DWDS 없음」, 접속사·서수·고유명사로만 있는 표제어 포함).
2. 품사가 DWDS 품사에 없으면, DWDS 품사가 하나뿐일 때만 그 품사로 고친다(「품사 고침」). 성·복수·발음·영어 뜻은 새 품사로 kaikki 를 다시 찾는다. 여럿이면 뺀다(「품사 불일치」).
3. DWDS 빈도 등급이 그 (표제어,품사)의 모든 항목에서 0 또는 1 이면 뺀다(「드문 단어」).
4. (표제어,품사)가 B1 이나 앞서 고른 단어(B2 는 앞선 B2, C1 은 B2 전체와 앞선 C1, 사람 판정 전 기준)와 같으면 뺀다(「중복」).

## B2 후보 선별
WordHoard cefr_estimate=B2 이면서 NOUN/VERB/ADJ/ADV 3244건
→ 기존 규칙(B1 중복·글자·kaikki·비속어) 통과 2598건
→ DWDS 대조 뒤 2378건
→ 사람 판정 제외 뒤 2220건

| 탈락 사유 | 건수 | 예(앞 15개) |
|---|---|---|
| kaikki 에 없음(자막 잡음·고유명사) | 581 | Ranger, russisch, elend, aufstinden, thern, lose, Ally, eingefall, fox, russisch, wünsch, konzentrieren, bates, toren, adl |
| DWDS 없음 | 132 | vierte, Spritzen, Cola, Samurai, dar, inwiefern, Mauern, Flitterwochen, unterer, Nazis, tank, mexikanisch, draussen, Irrer, LIF |
| 드문 단어 | 77 | wegtreten, wimmern, abknallen, knarren, Tussi, fingern, wiederhaben, Türklingel, Drecksack, Wurmloch, verpfeifen, prostituieren, Durchsuchungsbefehl, rummachen, Flittchen |
| B1 목록에 이미 있음 | 37 | anwesend, ernsthaft, aufführen, umdrehen, aufenthalt, empfehlung, stehenbleiben, soße, erwachsen, erziehung, erkundigen, erkälten, quer, zins, anwenden |
| kaikki 비속어 태그 | 14 | scheißen, scheißer, Prügel, matratze, klarmachen, flachlegen, anpissen, schlitten, nageln, scheißdreck, krepieren, lanze, pisse, kaviar |
| 3글자 미만 | 13 | f, ra, em, bh, kg, mi, dj, se, mo, dc, pu, ct, -- |
| 중복 | 11 | Welle, einzigartig, Wurm, angemessen, unabhängig, Pirat, fürchterlich, Hahn, ärgerlich, abscheulich, liebevoll |
| 글자 아닌 문자 포함 | 1 | voilà |

품사 고침 45건(그중 고친 뒤 빈도·중복으로 빠진 것 4건): ungeheuer adv→adj, besoffen verb→adj, überraschend adv→adj, angemessen adv→adj, reichlich adv→adj, stundenlang adv→adj, buchstäblich adv→adj, verknallt verb→adj, sexuell adv→adj, unabhängig adv→adj, hilflos adv→adj, benommen verb→adj, einzigartig adv→adj(빠짐: 중복), gelegentlich adv→adj, allergisch adv→adj, rasch adv→adj, umgehend adv→adj, fürchterlich adv→adj, unauffällig adv→adj, misstrauisch adv→adj, durchgeknallt verb→adj, verstorben verb→adj, entsetzlich adv→adj, entsprechend adv→adj, gestresst verb→adj, überflüssig adv→adj, ungeduldig adv→adj, unruhig adv→adj, förmlich adv→adj, verborgen adj→verb, monatelang adv→adj, tagelang adv→adj, wochenlang adv→adj, ärgerlich adv→adj(빠짐: 중복), abscheulich adv→adj(빠짐: 중복), leidenschaftlich adv→adj, bewaffnet verb→adj, höchstpersönlich adv→adj, außerordentlich adv→adj, liebevoll adv→adj(빠짐: 중복), ausdrücklich adv→adj, wahrhaftig adv→adj, spitze verb→adj, wiedergeboren adj→adv, überwältigend adv→adj

리드 대조(b2_dwds_keep.json, 같은 규칙으로 따로 만든 목록 2378건): 차이 없음

## C1 후보 선별
WordHoard cefr_estimate=C1 이면서 NOUN/VERB/ADJ/ADV 7105건
→ 기존 규칙(B1 중복·글자·kaikki·비속어) 통과 5302건
→ DWDS 대조 뒤 4500건
→ 사람 판정 제외 뒤 4327건

| 탈락 사유 | 건수 | 예(앞 15개) |
|---|---|---|
| kaikki 에 없음(자막 잡음·고유명사) | 1724 | brenne, harlem, eagle, Riggs, stacy, nell, Lebeau, kgb, alliierten, Aurora, wisch, lucrezia, danen, Motherfucker, boyle |
| 드문 단어 | 454 | heimzahlen, hierlassen, seinetwegen, aufheitern, Drecksarbeit, wegschaffen, Brautjungfer, Omelett, kugelsicher, saubermachen, verhauen, verkorksen, miauen, Krypton, heimgehen |
| DWDS 없음 | 294 | strahlend, geschissen, angriff, Rover, Chicken, Stalag, ausgebucht, grossartig, wohlauf, Erdnussbutter, weis, äußerer, Gunsten, Dreien, linder |
| 중복 | 54 | hilflos, moralisch, Model, entsprechend, durchgeknallt, leidenschaftlich, Maß, entsetzlich, Gebot, bewaffnet, Superheld, Lamm, überraschend, höllisch, besoffen |
| B1 목록에 이미 있음 | 29 | eignen, anstrengend, auftritt, beinah, farbig, asyl, vorspeise, schick, pensionieren, erzählung, Leiterin, Autorin, arbeiter, architekt, Verkäuferin |
| 3글자 미만 | 27 | pc, th, ss, mg, Ha, iv, bi, ps, AG, IG, pi, te, fe, pj, ra |
| kaikki 비속어 태그 | 16 | maus, verfickt, zimmern, möse, pisser, bescheißen, arschgesicht, abkratzen, einlochen, wichsen, verkacken, verschissen, poppen, pudern, arschgeige |
| 글자 아닌 문자 포함 | 7 | hélène, françoise, Là, ólafur, doña, Adèle, léon |

품사 고침 67건(그중 고친 뒤 빈도·중복으로 빠진 것 12건): auffällig adv→adj, zärtlich adv→adj, off adj→adv, angepasst verb→adj, moralisch adv→adj(빠짐: 중복), grauenhaft adv→adj, wörtlich adv→adj, entwickelt verb→adj, sprechend verb→adj, höllisch adv→adj, fehl adv→adj, einwandfrei adv→adj, aufdringlich adv→adj, gänzlich adv→adj, aufgesetzt verb→adj, verfasst verb→adj, angeschlagen verb→adj, grundsätzlich adv→adj, eigenhändig adv→adj, unverantwortlich adv→adj, barfuß adj→adv, jährlich adv→adj(빠짐: 중복), gefroren verb→adj(빠짐: 중복), geschwollen verb→adj, überzogen verb→adj, permanent adv→adj, augenblicklich adv→adj, aufgeschlossen verb→adj, abartig adv→adj, zurückhaltend adv→adj, vorzeitig adv→adj, generell adv→adj, gemacht verb→adj, offline adj→adv, erheblich adv→adj(빠짐: 중복), versessen verb→adj, käuflich adv→adj, ausführlich adv→adj, unecht adv→adj, pseudonym adv→adj, verlässlich adv→adj(빠짐: 중복), verächtlich adv→adj, widerwärtig adv→adj, schlussendlich adv→adj, konkret adv→adj(빠짐: 중복), betroffen verb→adj, vergleichbar adv→adj, seitlich adv→adj, gebacken verb→adj, gesichert verb→adj, künftig adv→adj(빠짐: 중복), freudig adv→adj(빠짐: 중복), laufend adv→adj, monatlich adv→adj(빠짐: 중복), zwingend adv→adj, überwiegend adv→adj, wöchentlich adv→adj(빠짐: 중복), abwechselnd adv→adj, symbolisch adv→adj, systematisch adv→adj, reibungslos adv→adj, indirekt adv→adj, erotisch adv→adj(빠짐: 중복), weiß verb→adj, schreiend verb→adj, strategisch adv→adj(빠짐: 중복), bereitwillig adv→adj

## 사람 판정 제외 (내용 파일 keep:false)
331건(B1 0 · B2 158 · C1 173). words·cards 에 넣지 않는다(words.json 에는 keep:false 로 남겨 다시 채우지 않음).
| 사유 | 건수 | 예(앞 10개) |
|---|---|---|
| 고유명사·국적 | 44 | Sander/noun, kanadisch/adj, Hanse/noun, Inder/noun, Latino/noun, indianisch/adj, dänisch/adj, schwedisch/adj, Jüdin/noun, Berliner/adj |
| 영어 차용 구어 | 33 | Thing/noun, Lover/noun, Call/noun, off/adv, Nerd/noun, Skipper/noun, chillen/verb, hip/adj, Smiley/noun, Ale/noun |
| 좁은 전문어 | 17 | Kaplan/noun, Bien/noun, Ave/noun, Omega/noun, Beta/noun, Kar/noun, Prior/noun, Gravis/noun, heuern/verb, Gamma/noun |
| 활용형·표제어 오류 | 16 | herbei/adv, schränken/verb, sprechend/adj, verfasst/adj, steifen/verb, Glotzen/noun, hellen/verb, Bohren/noun, inne/adv, pecken/verb |
| 고어·옛 철자 | 15 | jedesmal/adv, Schluß/noun, Jungfer/noun, Zeitlang/noun, Maid/noun, Tip/noun, Bureau/noun, Photo/noun, Ger/noun, Fluß/noun |
| 성적 표현 | 14 | Porno/noun, Stripper/noun, Orgasmus/noun, Nippel/noun, masturbieren/verb, erotisch/adj, Geschlechtsverkehr/noun, Orgie/noun, Sexualität/noun, Erektion/noun |
| 기타 | 13 | viermal/adv, tausendmal/adv, Beau/noun, Pipi/noun, fünfmal/adv, Grande/noun, LSD/noun, Dodo/noun, After/noun, rin/adv |
| 영화 대사용 | 10 | Empire/noun, Knappe/noun, Lord/noun, Cyborg/noun, Feldmarschall/noun, Verdammnis/noun, Magnum/noun, Revolverheld/noun, Heimatschutz/noun, Geisha/noun |
| 속어·비속어 | 10 | kiffen/verb, Mieze/noun, besaufen/verb, Missgeburt/noun, Popo/noun, Spanner/noun, Klapse/noun, Alk/noun, abgefuckt/adj, versaut/adj |
| 국적 명칭 | 9 | Italiener/noun, japanisch/adj, Spanier/noun, Grieche/noun, irisch/adj, Amerikanerin/noun, polnisch/adj, Russe/noun, Amerikaner/noun |
| 중복 표기 | 7 | Corps/noun, Portrait/noun, Weihnacht/noun, kucken/verb, Süd/noun, Email/noun, Mass/noun |
| 성적 어휘 | 6 | Kondom/noun, sexuell/adj, Vagina/noun, Schwule/noun, Sperma/noun, Bordell/noun |
| 국적·민족 명칭 | 6 | italienisch/adj, griechisch/adj, Brite/noun, Schweizer/adj, Mexikaner/noun, Ami/noun |
| 고어 | 5 | Knabe/noun, hold/adj, Adieu/noun, Marquis/noun, letzen/verb |
| 술 이름, 영화 대사 위주 | 4 | Gin/noun, Brandy/noun, Martini/noun, Tequila/noun |
그 밖의 사유 107가지 122건

제외 단어 전체(331): flashen/verb, Pirat/noun, Satan/noun, Miese/noun, doppeln/verb, Lesbe/noun, Kondom/noun, besoffen/adj, Bingo/noun, Italiener/noun, Weichei/noun, Khan/noun, Henker/noun, First/noun, Kacke/noun, Yard/noun, Werwolf/noun, Junkie/noun, flippen/verb, lesbisch/adj, bäumen/verb, Bro/noun, killen/verb, japanisch/adj, eisen/verb, Gin/noun, Knabe/noun, hold/adj, Spike/noun, sexuell/adj, bingen/verb, italienisch/adj, Greif/noun, griechisch/adj, Heiligkeit/noun, Vagina/noun, Adieu/noun, zähnen/verb, Fähnrich/noun, Brite/noun, Sultan/noun, Chan/noun, Department/noun, Schweizer/adj, Mexikaner/noun, Brandy/noun, Ami/noun, Martini/noun, Hunt/noun, Ren/noun, Schwule/noun, Tequila/noun, Marquis/noun, News/noun, verrecken/verb, Borg/noun, clean/adj, Jeep/noun, Diner/noun, pinkeln/verb, Spanier/noun, Hospital/noun, Center/noun, Porno/noun, Dienstmädchen/noun, Buddha/noun, Krüppel/noun, Gemahl/noun, Stripper/noun, Orgasmus/noun, Eminenz/noun, Araber/noun, Chi/noun, Blondine/noun, rocken/verb, Bridge/noun, Spass/noun, kacken/verb, Barbie/noun, Joint/noun, Torpedo/noun, indisch/adj, Speed/noun, Regiment/noun, afrikanisch/adj, Page/noun, Kerker/noun, erhören/verb, Dreier/noun, Sperma/noun, Metropolis/noun, Apache/noun, Donnerwetter/noun, Hook/noun, Neger/noun, Salut/noun, Ninja/noun, Legion/noun, Busen/noun, Helle/noun, Bordell/noun, Rain/noun, sinnen/verb, Venus/noun, listen/verb, Lux/noun, Kat/noun, Feldwebel/noun, Grieche/noun, Kavallerie/noun, Logbuch/noun, Homo/noun, mengen/verb, sowjetisch/adj, Pascha/noun, Türe/noun, Business/noun, Flint/noun, crazy/adj, engen/verb, Zar/noun, Break/noun, Musketier/noun, Cash/noun, Barbar/noun, Newton/noun, Run/noun, Kobold/noun, letzen/verb, Cape/noun, asiatisch/adj, Delphin/noun, Steuerbord/noun, Vergewaltiger/noun, irisch/adj, Lose/noun, Thing/noun, Schilling/noun, Amerikanerin/noun, Galgen/noun, polnisch/adj, Irrenhaus/noun, Pope/noun, Lover/noun, Base/noun, Madeleine/noun, Met/noun, Russe/noun, Zicke/noun, Scheich/noun, Viech/noun, Puff/noun, Mustang/noun, Moslem/noun, Cut/noun, Paß/noun, Amerikaner/noun, Call/noun, Sander/noun, off/adv, jedesmal/adv, herbei/adv, Nippel/noun, schränken/verb, Empire/noun, kanadisch/adj, viermal/adv, Schluß/noun, Jungfer/noun, Nerd/noun, kiffen/verb, tausendmal/adv, Hanse/noun, Knappe/noun, Kaplan/noun, Mieze/noun, sprechend/adj, Skipper/noun, Beau/noun, masturbieren/verb, Lord/noun, erotisch/adj, chillen/verb, Inder/noun, Latino/noun, Pipi/noun, indianisch/adj, Bien/noun, verfasst/adj, dänisch/adj, schwedisch/adj, Ave/noun, Jüdin/noun, besaufen/verb, hip/adj, Berliner/adj, Omega/noun, Geschlechtsverkehr/noun, steifen/verb, Französin/noun, schottisch/adj, Glotzen/noun, Zeitlang/noun, Smiley/noun, Orgie/noun, Sexualität/noun, Beta/noun, fünfmal/adv, hellen/verb, Ale/noun, arabisch/adj, Corps/noun, kubanisch/adj, Ecstasy/noun, Talk/noun, Sowjet/noun, Kar/noun, Schwede/noun, Gallier/noun, Grande/noun, LSD/noun, Maid/noun, türkisch/adj, Cyborg/noun, Lab/noun, Bohren/noun, Body/noun, relaxen/verb, Ire/noun, israelisch/adj, Däne/noun, Prior/noun, norwegisch/adj, Tip/noun, Singer/noun, Portrait/noun, Holländer/noun, Missgeburt/noun, inne/adv, Kanadier/noun, gay/adj, Weihnacht/noun, Popo/noun, Erektion/noun, Touch/noun, pecken/verb, Koreaner/noun, gemacht/adj, jährig/adj, Europäer/noun, Style/noun, Israeli/noun, Feldmarschall/noun, ägyptisch/adj, Verdammnis/noun, Magnum/noun, Killer/noun, Dodo/noun, fighten/verb, kucken/verb, Hulk/noun, australisch/adj, bashen/verb, Spanner/noun, belgisch/adj, Gravis/noun, Süd/noun, nice/adj, Bureau/noun, After/noun, heuern/verb, brasilianisch/adj, Gamma/noun, Airport/noun, Feeling/noun, Photo/noun, Peak/noun, iranisch/adj, Community/noun, Ger/noun, Fluß/noun, Dildo/noun, Krüger/noun, willigen/verb, Stripperin/noun, Born/noun, kontakten/verb, Cup/noun, rin/adv, riegeln/verb, traden/verb, zusammensein/verb, Chinesin/noun, Revolverheld/noun, tough/adj, Selbstmörder/noun, Heimatschutz/noun, Klapse/noun, Alk/noun, abgefuckt/adj, Kelvin/noun, persisch/adj, Email/noun, Relais/noun, Perser/noun, koreanisch/adj, straight/adj, Geisha/noun, Gulden/noun, Player/noun, Mass/noun, Kamp/noun, Schlumpf/noun, österreichisch/adj, Belgier/noun, Vibrator/noun, Schuß/noun, Kolumbianer/noun, versaut/adj, ABS/noun, bischen/verb, Perversion/noun, längen/verb, Pein/noun, Sure/noun, Anus/noun, Doge/noun, Blackjack/noun, Hobbit/noun, Eierstock/noun, skypen/verb

## kaikki 에 없어 보강 못 한 B1 (noun/verb/adj/adv 만)
42건: durcheinander, Müllabfuhr, Steward, runterwerfen, hieher, Profisportler, abhangen, Abwartin, allerschönst, Bancomat, Bancomatkarte, besonder, bio, EC-Karte, Entwickelung, färbig, Faschierte, Fasnacht, Führerausweis, Henderl, Intensivkurs, Kursleiter, Kursleiterin, Langweile, Migrantin, Mobilbox, noch mal, öfter, Pensionistin, Personenstand, Profisportlerin, Schlagrahm, Serviceangestellte, Spezialistin, Staub saugen, Umtausch, untersagt, Versichertenkarte, Wandrung, weltenweit, wohl, Zivilstand

## B1 안 중복(lemma,pos) — 첫 항목만 남김
없음

## Tatoeba 예문
기본 끔(TATOEBA=1 일 때만 빈 예문 자리에 씀). 적용: B1 0건 · B2 0건 · C1 0건

## 표본 B1 (앞 10건)
| id | lemma | pos | gender | plural | ipa | gloss_en | gloss_ko | example_src | freq_rank |
|---|---|---|---|---|---|---|---|---|---|
| w0001 | los | adv |  |  | /loːs/ | rid of, free of; off, out, used to indicate leaving motion. | 어서, 출발, (일이) 일어난 | gen | 98 |
| w0002 | damit | adv |  |  | /daˈmɪt/ | therefore, as a result | 그것으로, 그것과 함께 | gen | 137 |
| w0003 | nun | adv |  |  | /nuːn/ | now, at this moment; now, then; expressing a logical or temporal consequence | 이제, 지금 | gen | 147 |
| w0004 | Gott | noun | der | Götter | /ɡɔt/ | god | 신, 하느님 | gen | 157 |
| w0005 | wieso | adv |  |  | /viˈzoː/ | why | 왜, 어째서 | gen | 190 |
| w0006 | Nacht | noun | die | Nächte | /naxt/ | night; darkness | 밤 | gen | 198 |
| w0007 | gar | adv |  |  | /ɡaːr/ | at all; even; even; expressing a climax | 전혀, 심지어 | gen | 207 |
| w0008 | stimmen | verb |  |  | /ˈʃtɪmən/ | to be right, to be correct, to be proper, to be true; to vote | 맞다, 투표하다 | gen | 225 |
| w0009 | Fall | noun | der | Fälle | /fal/ | fall, drop (the act of falling or an instance thereof) | 경우, 사건, 추락 | gen | 287 |
| w0010 | verschwinden | verb |  |  | /fɛɐ̯ˈʃvɪndn̩/ | to disappear, to vanish, to move out of view; to leave, to go away | 사라지다 | gen | 289 |

## 표본 B2 (앞 10건)
| id | lemma | pos | gender | plural | ipa | gloss_en | gloss_ko | example_src | freq_rank |
|---|---|---|---|---|---|---|---|---|---|
| w1801 | Mörder | noun | der | Mörder | /ˈmœʁdɐ/ | murderer, assassin, assassinator, killer, slayer (male or of unspecified gender) | 살인자, 살인범 | gen | 734 |
| w1802 | Engel | noun | der | Engel | /ˈɛŋl̩/ | angel | 천사 | gen | 1376 |
| w1803 | Tausend | noun | das | Tausend | /ˈtaʊ̯zənt/ | thousand (set or unit of one thousand items) | 천, 수천 | gen | 2438 |
| w1804 | Jäger | noun | der | Jäger | /ˈjɛːɡɐ/ | hunter (male or of unspecified sex); fighter | 사냥꾼 | gen | 2758 |
| w1805 | Block | noun | der | Blöcke | /blɔk/ | bloc | 블록, 덩어리, 메모장 | gen | 3681 |
| w1806 | Eid | noun | der | Eide | /aɪ̯t/ | oath | 맹세, 선서 | gen | 4624 |
| w1807 | Funkgerät | noun | das | Funkgeräte | /ˈfʊŋkɡəˌʁɛːt/ | radio set; two-way radio | 무전기 | gen | 4625 |
| w1808 | Bude | noun | die | Buden | /ˈbuːdə/ | booth, stall; kiosk | 가판대, 작은 집, 자취방 | gen | 4630 |
| w1809 | ungeheuer | adj |  |  | /ˈʊnɡəˌhɔɪ̯ɐ/ | enormous; monstrous | 엄청난, 거대한 | gen | 4634 |
| w1810 | Häftling | noun | der | Häftlinge | /ˈhɛftlɪŋ/ | prison inmate | 수감자, 죄수 | gen | 4636 |

## 표본 C1 (앞 10건)
| id | lemma | pos | gender | plural | ipa | gloss_en | gloss_ko | example_src | freq_rank |
|---|---|---|---|---|---|---|---|---|---|
| w4021 | Agent | noun | der | Agenten |  | agent (male or of unspecified gender) (intermediary for certain services, such … | 요원, 첩보원 | gen | 658 |
| w4022 | Brauch | noun | der | Bräuche | /bʁaʊ̯x/ | custom | 풍습, 관습 | gen | 1236 |
| w4023 | Angriff | noun | der | Angriffe | /ˈanˌɡʁɪf/ | attack, offensive, strike, assault, onslaught, raid, offence | 공격 | gen | 1375 |
| w4024 | Wahnsinn | noun | der |  | /ˈvaːnzɪn/ | insanity, madness | 광기, 미친 짓 | gen | 1463 |
| w4025 | Bürgermeister | noun | der | Bürgermeister | /ˈbʏrɡərˌmaɪ̯stər/ | mayor (leader of a city, male or unspecified sex) | 시장 | gen | 1659 |
| w4026 | Minister | noun | der | Minister | /miˈnɪstɐ/ | minister (a person who is commissioned by the government for public service) | 장관 | gen | 2207 |
| w4027 | Tatort | noun | der | Tatorte | /ˈtaːtˌʔɔʁt/ | crime scene (location of a crime) | 범행 현장 | gen | 2219 |
| w4028 | Krieger | noun | der | Krieger | /ˈkʁiːɡɐ/ | warrior | 전사 | gen | 2353 |
| w4029 | Fluch | noun | der | Flüche | /fluːx/ | curse, malediction, bane | 저주, 욕설 | gen | 2496 |
| w4030 | Besitzer | noun | der | Besitzer | /bəˈzɪtsɐ/ |  | 소유자, 주인 | gen | 2588 |

## 자료 출처·라이선스
- Goethe-Zertifikat B1 단어 목록(DWDS 제공): 표제어·품사·성 목록으로만 사용.
- DWDS 표제어 목록: B2·C1 표제어·품사·빈도 등급 대조에만 사용.
- kaikki.org (Wiktextract, English Wiktionary 추출): 성·복수·IPA·영어 뜻. CC BY-SA 4.0 — "Wiktionary contributors, via kaikki.org (Tatu Ylonen, Wiktextract)".
- WordHoard German (wordhoard-de.csv): 빈도 순위·B2·C1 후보. CC BY-SA 4.0 — "WordHoard German frequency list".
- Tatoeba (tatoeba.org): 독·한 예문 쌍. CC BY 2.0 FR — 쓸 때는 example_src 에 tatoeba:<id> 로 출처 표기.

## 게이트 G1 (로컬 D1 적재 검증, 2026-10-14T01:45Z)
```
SELECT level, count(*) FROM words GROUP BY level → [{"level":"B1","n":1800},{"level":"B2","n":2220},{"level":"C1","n":4327}]
SELECT count(*) FROM cards → [{"n":8347}]
SELECT gloss_status, count(*) FROM words GROUP BY 1 → [{"gloss_status":"generated","n":8347}]
카드 없는 단어 → [{"n":0}]
표본:
{"id":"w0001","level":"B1","lemma":"los","pos":"adv","gender":null,"plural":null,"ipa":"/loːs/","gloss_en":"rid of, free of; off, out, used to indicate leaving motion.","gloss_ko":"어서, 출발, (일이) 일어난","example_de":"Los, der Zug fährt gleich ab!","example_src":"gen","freq_rank":98}
{"id":"w0004","level":"B1","lemma":"Gott","pos":"noun","gender":"der","plural":"Götter","ipa":"/ɡɔt/","gloss_en":"god","gloss_ko":"신, 하느님","example_de":"Viele Menschen glauben an Gott.","example_src":"gen","freq_rank":157}
{"id":"w1800","level":"B1","lemma":"Zwiebel","pos":"noun","gender":"die","plural":"Zwiebeln","ipa":"/ˈt͡sviːbəl/","gloss_en":"onion (typically Allium cepa, the plant or its bulb); bulb (of a plant)","gloss_ko":"양파","example_de":"Ich schneide die Zwiebel in kleine Stücke.","example_src":"gen","freq_rank":null}
{"id":"w1801","level":"B2","lemma":"Mörder","pos":"noun","gender":"der","plural":"Mörder","ipa":"/ˈmœʁdɐ/","gloss_en":"murderer, assassin, assassinator, killer, slayer (male or of unspecified gender)","gloss_ko":"살인자, 살인범","example_de":"Die Polizei hat den Mörder nach zwei Wochen gefasst.","example_src":"gen","freq_rank":734}
{"id":"w4021","level":"C1","lemma":"Agent","pos":"noun","gender":"der","plural":"Agenten","ipa":null,"gloss_en":"agent (male or of unspecified gender) (intermediary for certain services, such …","gloss_ko":"요원, 첩보원","example_de":"Der Agent wurde jahrelang vom Geheimdienst bezahlt.","example_src":"gen","freq_rank":658}
{"id":"w8347","level":"C1","lemma":"unersättlich","pos":"adj","gender":null,"plural":null,"ipa":"[ʊnɛɐ̯ˈzɛtlɪç]","gloss_en":"insatiable","gloss_ko":"만족할 줄 모르는","example_de":"Sein Hunger nach Macht ist unersättlich.","example_src":"gen","freq_rank":18485}
id·seq 어긋남 → [{"n":0}]
```
