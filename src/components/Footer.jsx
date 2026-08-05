import { Link, Text } from "@radix-ui/themes";

function Footer() {
  return (
    <footer style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', padding: '4px 16px 14px' }}>
      <Text weight="bold" align="center" color="gray" size={{ initial: "1", md: "2" }}>
        Did you know? This chatbot runs entirely in your browser. No data is sent to any server.&nbsp;
        <Link href="https://github.com/Encryptioner/private-chat" target="_blank">
          Learn more.
        </Link>
      </Text>
      <Text align="center" color="gray" size="1">
        Free &amp; open source · Made by{' '}
        <Link href="https://encryptioner.github.io/" target="_blank">
          Ankur Mursalin
        </Link>
        {' · '}
        <Link href="https://www.supportkori.com/mirmursalinankur" target="_blank" color="amber" highContrast weight="bold">
          ☕ Buy me a coffee
        </Link>
      </Text>
    </footer>
  );
}

export default Footer;
