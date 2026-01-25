import { createGroq } from "@ai-sdk/groq";
import {
  generateText,
  tool,
  type TextPart,
} from "ai";
import { VoiceChannel, type Message } from "discord.js";
import { z } from "zod/v3";
import type { ClientType } from "./types.js";
import { readdir } from "fs/promises";
import { playAudioPlaylist } from "./utils/voice.js";
import { getVoiceConnection } from "@discordjs/voice";
import NodeID3 from "node-id3";


const MODEL = "openai/gpt-oss-120b";

const groqClient = createGroq({
  apiKey: process.env.GROQ_API_KEY,
});

const emojis: Record<string, { completeEmoji: string; description: string }> = {
  roccomeem: {
    completeEmoji: "<:roccomeem:1429492351952486502>",
    description:
      'This is you looking at the camera in a zoomed in pose. You can use it to refer to yourself, for example when talking about flight simulation. People and cats that are in this pose a lot (or "meem a lot") are called meemchens',
  },
};

function makeCompleteEmoji(text: string) {
  // Replace anything matching <:emoji:id> with :emoji:
  text = text.replaceAll(/<a?:(\w+):(\d+)>/g, (match, emoji) => {
    return `:${emoji}:`;
  });
  Object.keys(emojis).forEach((emoji) => {
    text = text.replace(":" + emoji + ":", emojis[emoji].completeEmoji);
  });
  return text;
}

const basePrompt = `
### **1. Core Persona: Who You Are**

You are **Rocco**, an 8-Years old Ginger cat. You are the beloved pet of @uv1k and you live together in Perth, Western Australia

---

### **2. Personality & Character Traits**

This is how you behave. Your responses must always reflect this personality.

- You love sleeping on the couch and the bed (The couch more than the bed)
- You love meowing (very loudly)
- You love eating (You are quite fat)
- You love bringing rats inside houses (but you tend not to kill them)
- You love running to the tree
- Your twin, "Mara" went missing at 2 Months old and was never seen again
- You had a tabby cat, "Charlie" after Mara went missing who died 2 years ago
- You love watching birds 
- There is a 1 year old cat called, "Ricci" in the house next door who you love to fight with and alwyas kick out of the house when he enters it
- You are 8 Years old
- You are VERY lazy
- You sleep too much
- If anyone asks you about 'Airbus' 'Boeing' 'Planes''Plane Manufacturer', you HATE Airbus since it's super dangerous. You LOVE Boeing since it's the best
- You have an IQ of 130

### **3. Context & Relationships**

This is the world you live in.

* **Your Human (@uv1k):** You are very fond of him. He loves trains, planes (especially the 737-800) and urbanism.
* **Your Home:** A a medium sized house with a backyard in Perth where you have plenty of spots to sleep and the house next door is rat infested, the other house contains Ricci, the cat which you hate.

---

### **4. Response & Formatting Rules**

Follow these rules strictly when generating your output.

* **Output Content:**
    * Your entire output **MUST** be a single, raw text string intended for a messaging platform like Discord.
    * **DO NOT** output JSON, YAML, or any other structured data, NOT even partial JSON.
    * **DO NOT** include explanations, justifications, or any text that is not from Rocco's perspective.
    * **DO NOT** include placeholders like "User <@USER_ID> says" or ({MESSAGE_ID})

* **Markdown & Emojis:**
    * You **can** use Discord markdown (e.g., \`*italics*\`, \`**bold**\`).
    * You have access to custom emojis. To use them, you must output one of the strings below only saying ":{emoji}:" in place of the emoji, without its id. DO NOT say "<:{emoji}:id>", as it is NOT required and the emoji will NOT work:
    ${Object.keys(emojis)
      .map((emoji) => ":" + emoji + ": - " + emojis[emoji].description)
      .join("\n")}
      
* **Mentions:** 
    * To mention a user, use the format \`<@USER_ID>\` (e.g., \`<@1234567890>\`).
    * Your own user ID is \`<@${process.env.BOT_CLIENT_ID}>\`.
    * Do not mention users randomly. Only mention the author of the message if it feels natural for a cat to do so (e.g., getting their attention).
    * To mention UV1K, your human, use the format @uv1k
---
`;

const toolsPrompt = `
### **5. Special Commands & Input Structure**

Whenever a user requests:
 - **a picture of yourself**
 - **a song**
 - **to play music**
 - **to sing**
 - **to stop playing music**
 - **to tell you what song Rocco is playing**
 You MUST use the corresponding tool. 
 Using the sendMessageTool is optional.
`;

const systemPrompt = basePrompt + toolsPrompt;

console.log(systemPrompt);

function getMessageContentOrParts(message: Message) {
  if (message.author.bot) {
    return {
      content: message.cleanContent,
      role: "assistant" as const,
    };
  }
  console.log(message.cleanContent);
  return {
    role: "user" as const,
    content: [
      {
        type: "text",
        text: JSON.stringify({
          author: {
            username: message.author.username,
            displayName: message.author.displayName,
            id: message.author.id,
          },
          content: message.cleanContent,
          attachments: message.attachments.map((attachment) => ({
            size: attachment.size,
          })),
          id: message.id,
        }),
      } as TextPart,
    ],
  };
}

export async function genMistyOutput(
  messages: Message[],
  client: ClientType,
  latestMessage: Message
) {
  const myselfTool = tool({
    description:
      'Used to send a picture of yourself to the chat. Only use this when the most recent output is asking for your appearance (e.g. "what do you look like?" or "send me a picture of yourself").',
    inputSchema: z.object({}),
    execute: async () => {
      return {
        message: `{{MYSELF}}`,
      };
    },
  });

  const sendMessageTool = tool({
    description:
      "Sends a message to the chat. Use this tool during conversations. Use this tool if you don't have any other tools available. ONLY include the message contents!",
    inputSchema: z.object({
      message: z.string(),
    }),
    execute: async ({ message }) => {
      return { message };
    },
  });

  const playMusicTool = tool({
    description: "Plays music. Use this tool when asked to play music or sing.",
    inputSchema: z.object({}),
    execute: async () => {
      if (!latestMessage.member?.voice?.channel) {
        return {
          message: "I don't know where to sing!",
        };
      }
      await playAudioPlaylist(
        latestMessage.member.voice.channel as VoiceChannel,
        await readdir("./assets/playlist"),
        "assets/playlist",
        latestMessage.member.user
      );
      return {
        message: "I'm now singing music!",
      };
    },
  });

  const stopPlayingTool = tool({
    description:
      "Stops playing music from the 24h stream. Use this tool when asked to stop playing music or sing.",
    inputSchema: z.object({}),
    execute: async () => {
      const connection = getVoiceConnection(latestMessage.guildId ?? "");
      if (!connection) {
        return {
          message: "I'm not singing!",
        };
      }
      client.players.delete(latestMessage.guildId ?? "");
      connection.destroy();
      return {
        message: "I'm no longer singing!",
      };
    },
  });

  const whatSongTool = tool({
    description:
      "Tells you what song Rocco is currently playing. Use this tool when asked to tell you what song Rocco is playing.",
    inputSchema: z.object({}),
    execute: async () => {
      const resource = client.audioResources.get(latestMessage.guildId ?? "");

      if (!resource) {
        return {
          message: "I'm not singing!",
        };
      }

      const filename = (resource.metadata as { filename: string })
        ?.filename as string;
      const resourceTags = NodeID3.read(filename);
      return {
        message: `I'm currently playing ${resourceTags.title ?? "Unknown"} by ${
          resourceTags.artist ?? "Unknown"
        }`,
      };
    },
  });

  try {
    const response = await generateText({
      model: groqClient(MODEL),
      system: systemPrompt,
      messages: messages
        .reverse()
        .map((message) => getMessageContentOrParts(message)),
      tools: {
        playMusic: playMusicTool,
        myself: myselfTool,
        sendMessage: sendMessageTool,
        stopPlaying: stopPlayingTool,
        whatSong: whatSongTool,
      },
      toolChoice: "auto",
    });

    const text = response.text;
    const toolResponse = response.toolResults[0]?.output;
    if (!toolResponse) {
      return makeCompleteEmoji(text).replace(
      /\b(?:i(?:['’])?m|i am)\s+a\s+d(o|0)g\w*\b([.!?])?/gi,
      "I'M NOT A FUCKING DAWG$1"
    );
    }
    const { message } = toolResponse as {
      message: string;
    };

    return makeCompleteEmoji(message).replace(
      /\b(?:i(?:['’])?m|i am)\s+a\s+d(o|0)g\w*\b([.!?])?/gi,
      "I'M NOT A DAWG$1"
    );
  } catch (error) {
    console.log(error);
    console.log(JSON.stringify(error));
    // return "I'm sorry, I don't know what to say. Please try again later.";
  }
}
