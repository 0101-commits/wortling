# Wortling 씨앗 보고 (2026-10-13)

> **빈 DB 에만 넣는다.** id(w0001…)는 정렬 순서대로 매기는 자리 번호다. 단어가 하나만 늘거나 빠져도 그 뒤 id 가 전부 밀린다.
> 이미 씨앗이 든 DB 에 새 seed.sql 을 넣으면 다른 단어가 같은 id 를 받아, 쌓인 학습 기록(cards)이 엉뚱한 단어에 붙는다.
> 다시 넣을 때는 D1 을 새로 만들고 이주(migrations) → seed.sql 순서로 넣는다.

빌드 명령: `npm run seed:build` → seed/seed.sql (words 4020건, cards 4020건, INSERT 82문)
빌드 때 읽은 한국어 내용 파일: B1 6/6개 · B2 6/6개 — content_b1_1.json, content_b1_2.json, content_b1_3.json, content_b1_4.json, content_b1_5.json, content_b1_6.json, content_b2_1.json, content_b2_2.json, content_b2_3.json, content_b2_4.json, content_b2_5.json, content_b2_6.json
gloss_ko 채워진 단어: B1 1800건 · B2 2220건
내용 파일은 content_b[12]_[1-6].json 이름만 읽는다(쓰는 중인 조각 파일은 무시). 더 들어오면 같은 명령을 다시 돌리면 된다.

## 수준·품사별 수
| level | 합계 | noun | verb | adj | adv | prep | conj | pron | other | phrase |
|---|---|---|---|---|---|---|---|---|---|---|
| B1 | 1800 | 1027 | 390 | 255 | 79 | 6 | 25 | 14 | 3 | 1 |
| B2 | 2220 | 1133 | 701 | 316 | 70 | 0 | 0 | 0 | 0 | 0 |

## 채움 비율
| 항목 | B1 | B2 |
|---|---|---|
| 명사 성(gender) | 1026 (100%) | 1130 (100%) |
| 명사 복수(plural) | 958 (93%) | 1058 (93%) |
| 발음(ipa) | 1561 (87%) | 1899 (86%) |
| 영어 뜻(gloss_en) | 1657 (92%) | 2215 (100%) |
| 한국어 뜻(gloss_ko) | 1800 (100%) | 2220 (100%) |
| 예문(example_de) | 1800 (100%) | 2220 (100%) |
| 예문 출처 tatoeba | 0 (0%) | 0 (0%) |
| 그림 장면(scene_en) | 1800 (100%) | 2220 (100%) |
| 빈도 순위(freq_rank) | 1551 (86%) | 2220 (100%) |

## B2 후보 선별
WordHoard cefr_estimate=B2 이면서 NOUN/VERB/ADJ/ADV 3244건
→ 기존 규칙(B1 중복·글자·kaikki·비속어) 통과 2598건
→ DWDS 대조 뒤 2378건
→ 사람 판정 제외 뒤 2220건

DWDS 대조 순서(파일: DWDS 표제어 목록, 환경변수 DWDS_LEMMA_CSV 로 바꿈):
1. DWDS 에 명사·동사·형용사·부사 항목이 없으면 뺀다(「DWDS 없음」, 접속사·서수·고유명사로만 있는 표제어 포함).
2. 품사가 DWDS 품사에 없으면, DWDS 품사가 하나뿐일 때만 그 품사로 고친다(「품사 고침」). 성·복수·발음·영어 뜻은 새 품사로 kaikki 를 다시 찾는다. 여럿이면 뺀다(「품사 불일치」).
3. DWDS 빈도 등급이 그 (표제어,품사)의 모든 항목에서 0 또는 1 이면 뺀다(「드문 단어」).
4. (표제어,품사)가 B1 이나 앞선 B2 와 같으면 뺀다(「중복」). 같은 표기 반복(예전엔 5단계에서 지우던 것)과 품사를 고친 뒤 겹친 것이 함께 들어간다.

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

## B2 사람 판정 제외
내용 파일에서 keep:false 로 뺀 단어 158건(B2 158 · B1 0). words·cards 에 넣지 않는다.
| 사유 | 건수 | 예(앞 10개) |
|---|---|---|
| 국적 명칭 | 9 | Italiener/noun, japanisch/adj, Spanier/noun, Grieche/noun, irisch/adj, Amerikanerin/noun, polnisch/adj, Russe/noun, Amerikaner/noun |
| 성적 어휘 | 6 | Kondom/noun, sexuell/adj, Vagina/noun, Schwule/noun, Sperma/noun, Bordell/noun |
| 국적·민족 명칭 | 6 | italienisch/adj, griechisch/adj, Brite/noun, Schweizer/adj, Mexikaner/noun, Ami/noun |
| 고어 | 5 | Knabe/noun, hold/adj, Adieu/noun, Marquis/noun, letzen/verb |
| 술 이름, 영화 대사 위주 | 4 | Gin/noun, Brandy/noun, Martini/noun, Tequila/noun |
| 고유명사 | 4 | Spike/noun, Chan/noun, Hunt/noun, Buddha/noun |
| 구어 속어 | 3 | flashen/verb, Miese/noun, Junkie/noun |
| 영화 대사 전용 어휘 | 3 | Pirat/noun, Satan/noun, Werwolf/noun |
| 영화 대사 전용, 활용도 낮음 | 3 | Greif/noun, Fähnrich/noun, Sultan/noun |
| 성적 표현 | 3 | Porno/noun, Stripper/noun, Orgasmus/noun |
| 영어 차용 구어 | 3 | Thing/noun, Lover/noun, Call/noun |
| 비속어 | 2 | Kacke/noun, kacken/verb |
| 영어 속어 | 2 | Bro/noun, crazy/adj |
| 상표명 | 2 | Jeep/noun, Barbie/noun |
| 국적·민족 표현 | 2 | indisch/adj, afrikanisch/adj |
그 밖의 사유 99가지 101건

제외 단어 전체(158): flashen/verb, Pirat/noun, Satan/noun, Miese/noun, doppeln/verb, Lesbe/noun, Kondom/noun, besoffen/adj, Bingo/noun, Italiener/noun, Weichei/noun, Khan/noun, Henker/noun, First/noun, Kacke/noun, Yard/noun, Werwolf/noun, Junkie/noun, flippen/verb, lesbisch/adj, bäumen/verb, Bro/noun, killen/verb, japanisch/adj, eisen/verb, Gin/noun, Knabe/noun, hold/adj, Spike/noun, sexuell/adj, bingen/verb, italienisch/adj, Greif/noun, griechisch/adj, Heiligkeit/noun, Vagina/noun, Adieu/noun, zähnen/verb, Fähnrich/noun, Brite/noun, Sultan/noun, Chan/noun, Department/noun, Schweizer/adj, Mexikaner/noun, Brandy/noun, Ami/noun, Martini/noun, Hunt/noun, Ren/noun, Schwule/noun, Tequila/noun, Marquis/noun, News/noun, verrecken/verb, Borg/noun, clean/adj, Jeep/noun, Diner/noun, pinkeln/verb, Spanier/noun, Hospital/noun, Center/noun, Porno/noun, Dienstmädchen/noun, Buddha/noun, Krüppel/noun, Gemahl/noun, Stripper/noun, Orgasmus/noun, Eminenz/noun, Araber/noun, Chi/noun, Blondine/noun, rocken/verb, Bridge/noun, Spass/noun, kacken/verb, Barbie/noun, Joint/noun, Torpedo/noun, indisch/adj, Speed/noun, Regiment/noun, afrikanisch/adj, Page/noun, Kerker/noun, erhören/verb, Dreier/noun, Sperma/noun, Metropolis/noun, Apache/noun, Donnerwetter/noun, Hook/noun, Neger/noun, Salut/noun, Ninja/noun, Legion/noun, Busen/noun, Helle/noun, Bordell/noun, Rain/noun, sinnen/verb, Venus/noun, listen/verb, Lux/noun, Kat/noun, Feldwebel/noun, Grieche/noun, Kavallerie/noun, Logbuch/noun, Homo/noun, mengen/verb, sowjetisch/adj, Pascha/noun, Türe/noun, Business/noun, Flint/noun, crazy/adj, engen/verb, Zar/noun, Break/noun, Musketier/noun, Cash/noun, Barbar/noun, Newton/noun, Run/noun, Kobold/noun, letzen/verb, Cape/noun, asiatisch/adj, Delphin/noun, Steuerbord/noun, Vergewaltiger/noun, irisch/adj, Lose/noun, Thing/noun, Schilling/noun, Amerikanerin/noun, Galgen/noun, polnisch/adj, Irrenhaus/noun, Pope/noun, Lover/noun, Base/noun, Madeleine/noun, Met/noun, Russe/noun, Zicke/noun, Scheich/noun, Viech/noun, Puff/noun, Mustang/noun, Moslem/noun, Cut/noun, Paß/noun, Amerikaner/noun, Call/noun

## kaikki 에 없어 보강 못 한 B1 (noun/verb/adj/adv 만)
42건: durcheinander, Müllabfuhr, Steward, runterwerfen, hieher, Profisportler, abhangen, Abwartin, allerschönst, Bancomat, Bancomatkarte, besonder, bio, EC-Karte, Entwickelung, färbig, Faschierte, Fasnacht, Führerausweis, Henderl, Intensivkurs, Kursleiter, Kursleiterin, Langweile, Migrantin, Mobilbox, noch mal, öfter, Pensionistin, Personenstand, Profisportlerin, Schlagrahm, Serviceangestellte, Spezialistin, Staub saugen, Umtausch, untersagt, Versichertenkarte, Wandrung, weltenweit, wohl, Zivilstand

## B1 안 중복(lemma,pos) — 첫 항목만 남김
없음

## Tatoeba 예문
짝 2963건(독일어 70자 이하) 중 표제어가 낱말 그대로 들어간 문장을 씀. 적용: B1 0건 · B2 0건 (생성 예문보다 우선)

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

## 자료 출처·라이선스
- Goethe-Zertifikat B1 단어 목록(DWDS 제공): 표제어·품사·성 목록으로만 사용.
- kaikki.org (Wiktextract, English Wiktionary 추출): 성·복수·IPA·영어 뜻. CC BY-SA 4.0 — "Wiktionary contributors, via kaikki.org (Tatu Ylonen, Wiktextract)".
- WordHoard German (wordhoard-de.csv): 빈도 순위·B2 후보. CC BY-SA 4.0 — "WordHoard German frequency list".
- Tatoeba (tatoeba.org): 독·한 예문 쌍. CC BY 2.0 FR — 문장마다 example_src 에 tatoeba:<id> 로 출처 표기.

## 게이트 G1 (로컬 D1 적재 검증, 2026-10-13T09:23Z)
```
SELECT level, count(*) FROM words GROUP BY level → [{"level":"B1","n":1800},{"level":"B2","n":2220}]
SELECT count(*) FROM cards → [{"n":4020}]
SELECT gloss_status, count(*) FROM words GROUP BY 1 → [{"gloss_status":"generated","n":4020}]
카드 없는 단어 → [{"n":0}]
표본:
{"id":"w0001","level":"B1","lemma":"los","pos":"adv","gender":null,"plural":null,"ipa":"/loːs/","gloss_en":"rid of, free of; off, out, used to indicate leaving motion.","gloss_ko":"어서, 출발, (일이) 일어난","example_de":"Wann gehst du los?","example_src":"tatoeba:398613","freq_rank":98}
{"id":"w0004","level":"B1","lemma":"Gott","pos":"noun","gender":"der","plural":"Götter","ipa":"/ɡɔt/","gloss_en":"god","gloss_ko":"신, 하느님","example_de":"O mein Gott!","example_src":"tatoeba:2573383","freq_rank":157}
{"id":"w1800","level":"B1","lemma":"Zwiebel","pos":"noun","gender":"die","plural":"Zwiebeln","ipa":"/ˈt͡sviːbəl/","gloss_en":"onion (typically Allium cepa, the plant or its bulb); bulb (of a plant)","gloss_ko":"양파","example_de":"Ich schneide die Zwiebel in kleine Stücke.","example_src":"gen","freq_rank":null}
{"id":"w1801","level":"B2","lemma":"Mörder","pos":"noun","gender":"der","plural":"Mörder","ipa":"/ˈmœʁdɐ/","gloss_en":"murderer, assassin, assassinator, killer, slayer (male or of unspecified gender)","gloss_ko":"살인자, 살인범","example_de":"Der Mörder hat das Verbrechen gestanden.","example_src":"tatoeba:1172901","freq_rank":734}
{"id":"w4020","level":"B2","lemma":"scheppern","pos":"verb","gender":null,"plural":null,"ipa":"/ˈʃɛpərn/","gloss_en":"to clank, clash, clatter, rattle (make the sound of hard objects, e.g. metal or…","gloss_ko":"덜커덕거리다, 쨍그랑하다","example_de":"In der Küche hat es laut gescheppert.","example_src":"gen","freq_rank":9244}
id·seq 어긋남 → [{"n":0}]
```
