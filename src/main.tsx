import { Devvit } from '@devvit/public-api';
import { indent_codeblock, jsonEncode } from 'anthelpers';
import { DOMParser } from "@xmldom/xmldom";
import xpath from "xpath";
import { markdown_escape } from "anthelpers";

Devvit.configure({
  redditAPI: true,
  http: {
    domains: ['jigsaw.w3.org'],
  }
});

Devvit.addSettings([
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

type validateCSSResponse = { warningcount: number, errorcount: number, errors: string[], warns: string[] };
function validateCSS(text: string, appVersion?: string): Promise<validateCSSResponse> {
  const domParser = new DOMParser(), ua = typeof appVersion === 'string' ? `css-title-linter/${appVersion}` : 'css-title-linter';
  return fetch(`https://jigsaw.w3.org/css-validator/validator?text=${encodeURIComponent(text)}&output=soap12&warning=1`, {
    headers: { 'user-agent': ua },
  }).then(response => response.text()).then(function (resptext) {
    // console.log(resptext);
    return resptext;
  }).then(dom => domParser.parseFromString(dom)).then(function (doc) {
    // @ts-ignore
    const warnings = +xpath.select("//*[local-name()='warningcount']/text()", doc)[0].data;// @ts-ignore
    const errorcount = +xpath.select("//*[local-name()='errorcount']/text()", doc)[0].data;
    let warns = xpath.select("//*[local-name()='warning']", doc);
    let errors = xpath.select("//*[local-name()='error']", doc);// @ts-ignore
    errors = errors.map(error => xpath.select('*[local-name()=\'message\']/text()', error)[0]?.data ?? null);// @ts-ignore
    warns = warns.map(warnin => xpath.select('*[local-name()=\'message\']/text()', warnin)[0]?.data ?? null);// @ts-ignore
    errors = errors.filter(mixed => mixed !== null).map(error => dedent(error.toString()));// @ts-ignore
    warns = warns.filter(mixed => mixed !== null).map(warnin => dedent(warnin.toString()));
    const warningcount = warnings;// @ts-expect-errors
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
    if (event?.post === undefined) return;
    // Get the post title from the event
    const postTitle = event.post.title;
    let { text, isValid } = await respondCSS(postTitle);
    // console.log(text);

    //text = `${text}\n\n---\n\n${indent_codeblock(text)}`;
    text += '\n\nif i got anything incorrect either blame [the checker](https://jigsaw.w3.org/css-validator/)';
    text += ' or my creator. im using a diffrent validator than my previous';
    await (await context.reddit.submitComment({
      id: event.post.id, text,
    })).distinguish(true);
    if (!isValid && await context.settings.get('reportIfIncorrect')) {
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

// Devvit.addMenuItem({
//   location: 'subreddit',
//   label: 'check String',
//   forUserType: 'moderator',
//   description: 'Test the Filter',
//   async onPress(_event, context: Devvit.Context) {
//     context.ui.showForm(checkString);
//     // const currentUser = await context.reddit.getCurrentUsername();
//     // if (currentUser === undefined) return context.ui.showToast(`there is no currentUser`);
//   },
// });

// const checkString = Devvit.createForm(
//   {
//     fields: [
//       {
//         type: 'paragraph',
//         name: 'testString',
//         label: 'test string',
//         required: true,
//       },
//     ],
//     title: 'Test the Filter',
//     acceptLabel: 'Test',
//   },
//   async function (event, context: Devvit.Context) {
//     const { testString } = event.values;
//     try {
//       '.example { world: "!" }'
//       const ast = await validateCSS(testString);
//       console.log(jsonEncode({ ast }, 2));

//       context.ui.showToast('Yes')
//       // do things with result.report, result.errored, and result.results
//     } catch (err) {
//       // do things with err e.g.
//       console.error((err as Error).message);
//       context.ui.showToast('No')
//     }
//   }
// );

export default Devvit;
