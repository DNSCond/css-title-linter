import { Devvit, TriggerContext } from '@devvit/public-api';
import { jsonEncodeIndent, markdown_escape } from 'anthelpers';
import { CustomError } from './customError.js';

Devvit.configure({
  redditAPI: true,
  redis: true,
  http: {
    domains: ['jigsaw.w3.org'],
  }
});

Devvit.addSettings([
  // {
  //   type: 'boolean',
  //   name: 'working',
  //   label: 'should work',
  //   helpText: 'if you want to temporalily disable the bot',
  //   defaultValue: false,
  // },
  {
    type: 'boolean',
    name: 'reportIfIncorrect',
    label: 'report if css in post title is invalid css?',
    defaultValue: false,
  },
  // {
  //   type: 'select',
  //   name: 'warningLevel',
  //   label: 'report if css in post title is invalid css?',
  //   defaultValue: false,
  // },
]);

async function submitCommentAndDistinguish(context: TriggerContext, id: string, text: string, distinguish: boolean = true) {
  const comment = await context.reddit.submitComment({ id, text });
  if (distinguish) await comment.distinguish(true);
  return comment;
}


type validateCSSResponse = { warningcount: number, errorcount: number, errors: string[], warns: string[] };
function validateCSS(text: string, appVersion?: string): Promise<validateCSSResponse> {
  const ua = typeof appVersion === 'string' ? `css-title-linter/${appVersion}` : 'css-title-linter';
  return fetch(`https://jigsaw.w3.org/css-validator/validator?text=${encodeURIComponent(text)}&output=application%2fjson&warning=1`, {
    headers: { 'user-agent': ua },
  }).then(r => r, r => r).then(function (response) {
    if (!(response instanceof Response))
      throw new CustomError(`the return value isnt a response`, response);
    console.log('response.headers', response.status, Object.fromEntries(response.headers.entries()));
    if (!response.ok)
      throw new CustomError(`Response (${response.status}) is not ok`, response);
    return response;
  }, function (thisShouldNotHAppen) {
    console.error('thisShouldNotHAppen', thisShouldNotHAppen);
    throw thisShouldNotHAppen;
  }).then(response => response.text()).then(function (resptext) {
    const respjson = JSON.parse(resptext).cssvalidation;
    if (respjson === undefined) throw new CustomError('resptext is not json, or \'cssvalidation\' is undefined', { respjson, resptext });
    return respjson;
  }).then(function (doc: any) {
    let { warningcount, errorcount } = doc.result;
    warningcount = +warningcount; errorcount = +errorcount;
    const errors: string[] = [], warns: string[] = [];
    if ('errors' in doc) {
      for (const element of doc.errors) {
        errors.push(element.message as string);
      }
    }
    if ('warnings' in doc) {
      for (const element of doc.warnings) {
        warns.push(element.message as string);
      }
    }
    return { warningcount, errorcount, errors, warns } as validateCSSResponse;
  });
}

function respondCSS(text: string): Promise<{ text: string, isValid: boolean }> {
  return validateCSS(text).then(function (resp) {
    // Congratualtion
    if (resp.warningcount === 0 && resp.errorcount === 0) {
      return { text: `Congratulation, your title contains valid css`, isValid: true };
    }
    let text = '';
    if (resp.errorcount) {
      text += `There are ${resp.errorcount} errors\n`;
      for (const error of resp.errors) {
        text += `\n- ${markdown_escape(error).replace(/\n/, '\n  ')}`;
      }
    }
    if (resp.warningcount) {
      if (resp.errorcount) text += '\n\n';
      text += `There are ${resp.warningcount} warnings\n`;
      for (const warn of resp.warns) {
        text += `\n- ${markdown_escape(warn).replace(/\n/, '\n  ')}`;
      }
    }
    const isValid = false;
    return { text, isValid };
  });
}


Devvit.addTrigger({
  event: 'PostSubmit',
  onEvent: async function (event, context) {
    const authorId = event.author?.id;
    if (event?.post === undefined || authorId === undefined) {
      return;
    }
    // Get the post title from the event
    const postTitle = event.post.title;
    const postId = event.post.id;

    const key = `post_submit_authorId:${authorId}`;
    if (await context.redis.get(key)) {
      const text = 'im limiting myself to you to not 429 the provider';
      await submitCommentAndDistinguish(context, postId, text, true);
      return;
    }

    const submittedAt = (new Date(event.post.createdAt ?? Date.now())).toISOString();
    const value = JSON.stringify({ authorId, submittedAt, postId });
    let ratelimit: string | undefined;
    if (ratelimit = await context.redis.get('subreddit-ratelimit')) {
      const ratelimitJS = JSON.parse(ratelimit) as { submittedAt: string };
      const diff = Math.abs(Date.now() - Date.parse(ratelimitJS.submittedAt));
      if (diff < 15) {
        const text = 'im limiting myself to the subreddit to not 429 the provider';
        await submitCommentAndDistinguish(context, postId, text, true);
        return;
      }else if(!isFinite(diff)){
        const text = 'im limiting myself to the subreddit to not 429 the provider';
        await submitCommentAndDistinguish(context, postId, text, true);
      }
    }
    await context.redis.set('subreddit-ratelimit', JSON.stringify({ submittedAt }));
    await context.redis.expire('subreddit-ratelimit', 10800*3);// 9 hours (3h * 3)

    await context.redis.set(key, value);
    await context.redis.expire(key, 17);// 3 hours
    const reportIfIncorrect = Boolean(await context.settings.get('reportIfIncorrect'));
    let { text, isValid } = await respondCSS(postTitle);

    //text = `${text}\n\n---\n\n${indent_codeblock(text)}`;
    text += '\n\nif i got anything incorrect either blame [the checker](https://jigsaw.w3.org/css-validator/)';
    text += ' or my creator. im using a diffrent validator than my previous';
    await submitCommentAndDistinguish(context, postId, text, true);
    if (!isValid && reportIfIncorrect) {
      const reason = 'This post contains Invalid CSS in the title',
        reportablePost = context.reddit.getPostById(event.post.id);
      await context.reddit.report(await reportablePost, { reason });
    }
  },
});

function dedent(string?: string) {
  if (typeof string !== 'string') return string;
  return string.trimEnd().replaceAll(/^\s+/gm, '');
}

export default Devvit;

// function JSONPrettyPrint(mixed, indent = 2) {return JSON.stringify(JSON.parse(mixed), null, indent);}
