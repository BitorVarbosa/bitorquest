# Playing Bitor Quest

Bitor Quest is a role-playing game for one player. You play the protagonist; an AI model narrates the
world and speaks for everyone in it (Claude, or a model at Venice or NanoGPT: you choose); a small set
of tabletop rules, called Penta, decides what succeeds. Em português: [JOGAR.md](JOGAR.md).

## What you need

- A browser on a PC or a phone.
- An API key of your own from one of the three services that can play the game: Claude, Venice or
  NanoGPT (see below). You add credit at the service and pay it for what you play. Set a spending
  limit on the key there as well as the daily limit in the app.
- Or nothing at all, to look around: **Try it without a key** uses a demo narrator that answers with
  canned text, sends nothing and costs nothing.

Your keys and your stories stay on your device. The app sends what you play only to the services you
chose, each with its own key, and nowhere else.

## Who plays the game

Three services can play it, each with a key of your own. Give the app one, two or all three, in
Settings, "Services and keys".

- **Claude**, by Anthropic: the richest storytelling, and long stories stay cheap because what was
  already read is cached. Key: the Claude Console at platform.claude.com (separate from a claude.ai
  subscription). Add credit, create a key just for this app and set a monthly limit on it.
- **Venice**: private. Its own models keep nothing of what you send, and many of them are uncensored.
  Key: venice.ai/settings/api. Add credit and create a key just for this app; if Venice offers a
  privacy setting for the key, choose **Private models only**, so that the key itself refuses any
  model that is not private. In the app, **Venice's own models only** (on from the start) keeps the
  other Venice models out of the game.
- **NanoGPT**: hundreds of models from many companies, uncensored ones among them. Most pass what you
  send on to the company that runs them. Key: the API page of your account at nano-gpt.com, after
  adding balance. In the app, **Private providers only** sends the story only to providers that
  promise to keep nothing of it (some models then do not answer). NanoGPT can also blank out names
  and other personal details before a model sees them; the game asks it not to, so that the story
  arrives whole.

In Settings, "Models", **Who plays the game** puts every role on one service: Claude with one of its
presets, or Venice or NanoGPT with a model for each role chosen from that service's current list. Or
mix them: the narrator, the referee, the scribe, the world builder and the model that reads pictures
each take a model of their own, from any service you have a key for, and each request goes only to
the service of its model. To keep a story wholly private, put every role on Venice's own models.

Mixing has one catch. When another service writes the story but Claude still judges your actions or
keeps the records, Claude reads every scene, so Anthropic's usage policy applies to all of it.

## What it costs

With Claude's recommended models a turn costs well under a cent: a few hundred turns to the dollar. At
Venice and NanoGPT it depends on the models you choose; the list shows each one's price. Every turn
shows what it cost, the Usage screen adds it up by day and by story, and play pauses when a day's
spending reaches the limit you set. Building a world of your own costs a few cents, once.

## Starting

1. **The sample story.** "The Glass Road" puts you in the boots of Aren, a courier on the Lantern
   Coast, on the twelfth day of a journey, with a sealed letter people are willing to kill for. It is
   the quickest way to see how the game plays.
2. **A character of your own on the Lantern Coast.** The same coast, on your first day there, as a
   stranger. Nobody knows you yet.
3. **A world of your own.** Describe it in your own words (a few lines are enough, and it can be as long as you like), name a setting the world builder already knows, or give
   the app a document of yours (a text, Markdown or PDF file: your campaign notes, a setting book).
   Say who you want to play and how the table should run (how deadly, with which powers, with
   romance or without). An empty page? Begin from one of the worlds offered, or roll one. The world builder asks a few questions, builds the world in seven steps with
   the price shown before anything is spent, and you read it through before accepting it. Then you
   make a character for it: the builder proposes a sheet, the rules check it, and you can change any
   part. If someone starts the story at your side, **Who travels with you** lets you say how they look
   and who they are, in your own words or from a picture (a screenshot will do: it is put into words
   once and not kept). You can do the same later on their profile, with the pencil. The story then
   opens with a few lines on who you are, where you are and why, before anything happens.

## Playing a turn

Type what your character does or says, in your own words. Then:

- The **referee** reads it and decides whether a rule applies. Most things simply happen. When the
  outcome is uncertain and failing would be interesting, a die is rolled. **You throw it**: the die
  waits for you to press it (or the Roll button, or Space), and nothing more is told until it has
  landed. In a fight each blow is a throw of its own, and "All" throws what is left of the round at
  once. If you would rather not, Settings, "Narration", "Throw the dice yourself" lets the app throw.
- The **narrator** tells what happens.
- When a scene ends, the **scribe** writes it up, so that the story remembers.

"To" beside the text box directs your words at one person in the scene. Choosing "The narrator" there
asks a question outside the story, as you would ask a game master: what a passage meant, what you
could do, how a rule works. Nothing happens in the story when you do.

Suggestions under the text box are only suggestions. You can always type something else.

**When a passage misses.** Under the newest turn, **Another take** tells it again: the same dice and
the same results, in new words, for the price of one more reply. Add a note if you like ("shorter",
"Mira would not laugh here"). Every telling is kept, and the arrows go back to an earlier one for
free.

**Keeping things straight.** Press a line of the story to **keep it as true**, or to say **that it is
wrong** and what is true instead. It is kept on the card of the person or place it is about (or the
story's), and the narrator keeps to it from then on. You find what you kept on profiles, in the codex
and in the journal, where you can let it go.

**Letting time pass.** Just say it in the story: "we camp here until Tobin comes back", "I wait out
the storm". A rest of a few hours simply happens. For anything longer the game asks first whether to
let the days pass (that question costs nothing). The narrator then tells the stretch, and ends it
early if something the story has set up arrives sooner: a week of waiting with a dragon due in two
days ends after two days. You cannot wait out a fight, or something under way.

## The rules in one page

- **Five attributes**: Strength, Skill, Resistance, Armor, Firepower. A test rolls one six-sided die
  against the attribute that fits, one easier with the right skill, harder for a hard task. A 6
  always fails.
- **Hit points and energy.** Energy pays for abilities. Rest brings both back.
- **Fights** are played round by round: attack, defend, use an ability or an item, or get away.
  Opponents are described by how hurt they look, never by a number. At 0 hit points you choose:
  spend a point of destiny to get back up, or take what the table style decides.
- **Table style**, chosen for each story: Story (nobody dies by the dice), Adventure (danger is real,
  softened once a chapter), Brutal (what the dice say stands, and there is no going back).
- **Powers**, set by the world: none; Focus (six paths, abilities learned one at a time, from people
  who teach them or by daring to try); Extreme (whole schools of power, broad and costly); or Gift
  (one power of your own, described in your words).
- **A power of your own**, in a Gift world. Say what it is when you describe your character ("I ate
  a fruit that made my body rubber") and the builder proposes it: a name, what it covers, its limit,
  a rank, and a few moves. What it does all the time is simply true in the story. A **move** is yours
  to use at will, for energy. Anything else your power could do, you try: type what you do, and it
  costs a little more energy and a Skill test, and reaches no further than the rank. When it works
  you can keep it as a new move on the Character screen, under a name of your choosing. Some of the
  people you meet have a power of their own, and use it in a fight.
- **More powers, in a Gift world.** You can hold up to four. Several ways to gain one:
  - A **discipline** of the world (a trained art many share) is taught by someone who practises it,
    once they trust you, and is then learned for 10 experience. One that cannot be taught may awaken
    after you have been brought down in a fight.
  - An **item of power** is found in the story, for nothing. One you eat gives you its power for good
    (one each). One you carry lends you its power while you hold it.
  - If your own power copies or steals, you can take on someone's power until the scene ends.

  Beware people whose power seals yours for a turn. And beware a thief: if one beats you, they take
  your power until you beat them in turn, or they die.
- **Money** belongs to the world: each world names its own (a world can have several, or none). Say
  in the story what you buy, sell, give or change; the price is set by the rules from what such a
  thing usually costs. Friends ask less, and haggling (a test) can bring it down. What you find or are
  given is added to your purse and your bag.
- **Efforts that add up.** A chase, a search, a heist or a debate takes several tests: enough
  successes win it, too many failures lose it. A track above the text box shows how far it has got.
- **Experience** comes at the end of each scene. Ten points raise an attribute, a path or the rank
  of your power; one point, and a test, learns an ability you have been shown; one point keeps a new
  use of your power as a move.

## People

Everyone you meet has a **bond** with you, from 0 to 100, in five stages: Acquaintance, Friendly,
Trusted, Close, Devoted.

- A bond grows from acts that matter to that person, more when they touch something the person
  values. Courtesies add a little and are capped each day.
- Each new stage brings a **moment** with that person: give them quiet time in the story and it comes.
- Someone you are **Trusted** by will travel with you if you ask and your party has room. A companion
  stays behind when you tell them to, and comes back when asked.
- Someone you are **Close** to may ask for your help with something of their own. It becomes a thread
  in your journal.
- A betrayal or a broken promise leaves a **grievance**: the bond grows at half speed until you do
  something for them that matters. A companion who holds one, and is no longer Friendly, leaves.
- People remember what you did in front of them, and what they were told. A secret is safe with a
  friend; someone who is no friend of yours tells the people around them.

## The world goes on

The world you play in has things in motion: a plot, a levy, something waking under the hill. They move
on, stage by stage, whether you look or not, and you hear of them as talk in the towns. What you do
can hold them back or end them. Situations you walk away from end by themselves, and people leave,
move and die.

## How a story ends

When you begin a story you choose: **with an ending** (short, medium or long: about three, six or ten
chapters) or one that **goes on** for as long as you play. A story with an ending builds to a final
chapter; when it is over, an epilogue (written when you ask, once) tells what became of everyone.
Then you can go on as a new season, or begin a new hero in the same world, where the old one is
remembered. Any story can be saved as a **book**: one page to read or print, from the journal or the
list of stories.

## Going back

Except in the Brutal style, you can rewind the story to the start of an earlier scene (Journal,
"Rewind to here"). The story goes on from there as if the later turns had not happened: what was
done, what was spent in the story, what people know. The story as it was is kept as a separate copy,
so nothing is lost. The money already paid for the later turns is not given back.

## Your data

- Stories and worlds are kept in the browser's storage on this device. **Export** the ones you care
  about (Settings, "Your data"): a browser may clear its storage when the device runs short of space.
- An exported story is one file. Import it on another device to continue there. Your keys are never
  in it.
- A world can be exported and shared too. Starting a story copies the world, so two stories in one
  world do not affect each other.

## Installing it

Bitor Quest is a web page that can be installed like an app: Settings, "About", **Install**; or your
browser's menu ("Install", "Add to Home screen"). On an iPhone or iPad: Safari, Share, "Add to Home
Screen". Installed, it opens in a window of its own and without a network connection. Playing still
needs one.

## Two languages

The interface is in English or Portuguese (Settings, "Look", Language; or the switch on the welcome screen). A story is told in the language
chosen when its world was built, whatever the interface is in.
